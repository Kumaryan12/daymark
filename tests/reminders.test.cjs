const vm=require('node:vm');
const fs=require('node:fs');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const filename='../aws/reminders/handler.cjs';
const records=new Map();
class GetItemCommand{constructor(input){this.input=input}}
class PutItemCommand{constructor(input){this.input=input}}
class UpdateItemCommand{constructor(input){this.input=input}}
class DeleteItemCommand{constructor(input){this.input=input}}
class QueryCommand{constructor(input){this.input=input}}
const fail=()=>{throw Object.assign(new Error('conditional'),{name:'ConditionalCheckFailedException'})};
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
let beforeGet;
const db={async send(command){
 const p=command.input;
 const id=(p.Key||p.Item)?.pk.S;
 const existing=records.get(id);
 const values=p.ExpressionAttributeValues||{};
 if(command instanceof GetItemCommand){
  if(beforeGet){const callback=beforeGet;beforeGet=null;callback()}
  return {Item:copy(records.get(id))};
 }
 if(command instanceof QueryCommand)return {Items:[...records.values()].filter(item=>+item.nextAt.N<=+values[':now'].N).map(copy)};
 if(command instanceof PutItemCommand){
  if(p.ConditionExpression.includes('#version <')&&existing&&+existing.version.N>=+values[':version'].N)fail();
  if(p.ConditionExpression.includes('#version =')&&(!existing||existing.version.N!==values[':version'].N))fail();
  if(p.ConditionExpression.includes('leaseId')&&existing?.leaseId?.S!==values[':lease'].S)fail();
  records.set(id,copy(p.Item));return {};
 }
 if(command instanceof UpdateItemCommand){
  if(!existing||existing.version.N!==values[':version'].N)fail();
  if(values[':lease']){
   if(existing.leaseUntil&&+existing.leaseUntil.N>=+values[':now'].N)fail();
   existing.leaseId=values[':lease'];existing.leaseUntil=values[':until'];
  }else existing.testedAt=values[':now'];
  return {};
 }
 if(command instanceof DeleteItemCommand){records.delete(id);return {}}
}};
const commands={GetItemCommand,PutItemCommand,DeleteItemCommand,UpdateItemCommand,QueryCommand,DynamoDBClient:class{}};
const exported={};
const sandbox={exports:exported,require(name){return name==='node:crypto'?crypto:name==='web-push'?{sendNotification:async()=>{}}:commands},
 process:{env:{ALLOWED_ORIGINS:'https://test.example',TABLE_NAME:'test'}},console,Buffer,URL,setTimeout};
vm.runInNewContext(fs.readFileSync(require.resolve(filename),'utf8'),sandbox);
const calls=[];
const service=exported.createService(db,async(sub,payload)=>{calls.push(JSON.parse(payload))});
const pair=crypto.createECDH('prime256v1');pair.generateKeys();
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{auth:crypto.randomBytes(16).toString('base64url'),p256dh:pair.getPublicKey().toString('base64url')}};
let revision=1;
const event=(method,path,body)=>({rawPath:path,requestContext:{http:{method}},headers:{origin:'https://test.example',authorization:'Bearer '+'a'.repeat(64)},...(body?{body:JSON.stringify(body)}:{})});
const sync=tasks=>service.api(event('PUT','/schedule',{revision:revision++,subscription,origin:'https://test.example',tasks}));
const task={id:'fee',title:'Pay fees',at:Date.now()+5000};
(async()=>{
 assert.equal(exported.validSubscription({...subscription,endpoint:'http://127.0.0.1/'}),false);
 assert.equal(exported.validSubscription({...subscription,endpoint:'https://fcm.googleapis.com.evil.test/x'}),false);
 assert.equal((await service.api({...event('PUT','/schedule'),headers:{origin:'https://test.example'}})).statusCode,401);
 assert.equal((await sync([task])).statusCode,200);
 const record=()=>JSON.parse([...records.values()][0].payload.S);
 await sync([{...task,at:Date.now()+3600000}]);
 assert.ok(record().tasks[0].at>task.at);
 assert.equal((await service.dispatch()).delivered,0);
 await sync([]);
 assert.equal(record().tasks.length,0);
 await sync([{...task,at:Date.now()-100}]);
 assert.equal((await service.dispatch()).delivered,1);
 assert.equal(calls.length,1);
 assert.equal((await service.dispatch()).delivered,0);
 await sync([{...task,at:Date.now()+3600000}]);
 const stored=[...records.values()][0];
 stored.nextAt.N=String(Date.now()-1000); // Simulate a stale GSI result after rescheduling.
 assert.equal((await service.dispatch()).delivered,0);
 assert.equal(calls.length,1);
 await service.api(event('DELETE','/schedule'));
 assert.equal(records.size,0);
 console.log('Reminder checks passed: authenticated snapshots, reschedule, completion, stale GSI, sent tracking, SSRF input rejection and device removal.');
})().catch(error=>{console.error(error);process.exitCode=1});
