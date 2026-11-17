const ref = name => ({ Ref: name });
const get = (name, field) => ({ 'Fn::GetAtt': [name, field] });
const sub = text => ({ 'Fn::Sub': text });
const resource = (Type, Properties) => ({ Type, Properties });
const template = {
  AWSTemplateFormatVersion: '2010-09-09',
  Description: 'Daymark opt-in device reminders using Web Push',
  Parameters: {
    CodeBucket: { Type: 'String' }, CodeKey: { Type: 'String' },
    PublicKey: { Type: 'String' }, PrivateKey: { Type: 'String', NoEcho: true },
    AllowedOrigins: { Type: 'String' },
  },
  Resources: {
    Devices: resource('AWS::DynamoDB::Table', {
      BillingMode: 'PROVISIONED',
      AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'dueGroup', AttributeType: 'S' }, { AttributeName: 'nextAt', AttributeType: 'N' }],
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
      ProvisionedThroughput: { ReadCapacityUnits: 3, WriteCapacityUnits: 2 },
      GlobalSecondaryIndexes: [{
        IndexName: 'DueIndex', KeySchema: [{ AttributeName: 'dueGroup', KeyType: 'HASH' }, { AttributeName: 'nextAt', KeyType: 'RANGE' }],
        Projection: { ProjectionType: 'KEYS_ONLY' }, ProvisionedThroughput: { ReadCapacityUnits: 2, WriteCapacityUnits: 2 },
      }],
      TimeToLiveSpecification: { AttributeName: 'expires', Enabled: true },
    }),
    Logs: resource('AWS::Logs::LogGroup', { LogGroupName: sub('/aws/lambda/${AWS::StackName}'), RetentionInDays: 7 }),
    Role: resource('AWS::IAM::Role', {
      AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] },
      Policies: [{
        PolicyName: 'DeviceReminderStorage',
        PolicyDocument: { Version: '2012-10-17', Statement: [
          { Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Query'], Resource: [get('Devices','Arn'), sub('${Devices.Arn}/index/*')] },
          { Effect: 'Allow', Action: ['logs:CreateLogStream','logs:PutLogEvents'], Resource: get('Logs','Arn') },
        ] },
      }],
    }),
    Function: resource('AWS::Lambda::Function', {
      FunctionName: ref('AWS::StackName'), Runtime: 'nodejs22.x', Handler: 'index.handler',
      Role: get('Role','Arn'), Timeout: 60, MemorySize: 128, ReservedConcurrentExecutions: 2,
      Code: { S3Bucket: ref('CodeBucket'), S3Key: ref('CodeKey') },
      Environment: { Variables: { TABLE_NAME: ref('Devices'), VAPID_PUBLIC_KEY: ref('PublicKey'), VAPID_PRIVATE_KEY: ref('PrivateKey'), ALLOWED_ORIGINS: ref('AllowedOrigins') } },
    }),
    Api: resource('AWS::ApiGatewayV2::Api', {
      Name: ref('AWS::StackName'), ProtocolType: 'HTTP',
      CorsConfiguration: { AllowOrigins: { 'Fn::Split': [',', ref('AllowedOrigins')] }, AllowMethods: ['PUT','POST','DELETE'], AllowHeaders: ['Authorization','Content-Type'], MaxAge: 300 },
    }),
    Integration: resource('AWS::ApiGatewayV2::Integration', { ApiId: ref('Api'), IntegrationType: 'AWS_PROXY', IntegrationMethod: 'POST', IntegrationUri: get('Function','Arn'), PayloadFormatVersion: '2.0' }),
    Route: resource('AWS::ApiGatewayV2::Route', { ApiId: ref('Api'), RouteKey: 'ANY /{proxy+}', Target: sub('integrations/${Integration}') }),
    Stage: resource('AWS::ApiGatewayV2::Stage', { ApiId: ref('Api'), StageName: '$default', AutoDeploy: true, DefaultRouteSettings: { ThrottlingRateLimit: 3, ThrottlingBurstLimit: 10 } }),
    ApiInvoke: resource('AWS::Lambda::Permission', { FunctionName: ref('Function'), Action: 'lambda:InvokeFunction', Principal: 'apigateway.amazonaws.com', SourceArn: sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/*/*/*') }),
    Clock: resource('AWS::Events::Rule', { ScheduleExpression: 'rate(1 minute)', State: 'ENABLED', Targets: [{ Id: 'Dispatch', Arn: get('Function','Arn') }] }),
    ClockInvoke: resource('AWS::Lambda::Permission', { FunctionName: ref('Function'), Action: 'lambda:InvokeFunction', Principal: 'events.amazonaws.com', SourceArn: get('Clock','Arn') }),
  },
  Outputs: {
    ApiUrl: { Value: get('Api','ApiEndpoint') },
    Table: { Value: ref('Devices') },
    PublicKey: { Value: ref('PublicKey') },
  },
};
process.stdout.write(JSON.stringify(template, null, 2) + '\n');
