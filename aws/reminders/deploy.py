#!/usr/bin/env python3
"""Deploy the opt-in Web Push service. VAPID secrets remain in process memory and AWS."""
from pathlib import Path
import hashlib
import io
import json
import os
import subprocess
import zipfile


ROOT = Path(__file__).resolve().parent
REGION = os.environ.get("AWS_REGION", "ap-south-1")
STACK = "daymark-reminders"
ORIGINS = "https://main.d1xsxokyfc76bs.amplifyapp.com,https://daymark-notice-inbox.nitgoa2023.chatgpt.site"

def aws(*args, data=None):
    cmd = ["aws", *args, "--region", REGION, "--output", "json", "--no-cli-pager"]
    if data:
        import boto3
        # Export temporary CLI credentials directly into memory for this API call.
        credentials = json.loads(subprocess.check_output(["aws", "configure", "export-credentials", "--format", "process"], text=True))
        client = boto3.client(args[0], region_name=REGION,
            aws_access_key_id=credentials["AccessKeyId"], aws_secret_access_key=credentials["SecretAccessKey"],
            aws_session_token=credentials.get("SessionToken"))
        return getattr(client, args[1].replace("-", "_"))(**data)
    result = subprocess.run(cmd, text=True, capture_output=True)
    if result.returncode:
        # Do not include command arguments or raw responses containing function secrets.
        raise RuntimeError(result.stderr.splitlines()[-1] if result.stderr else "AWS operation failed")
    return json.loads(result.stdout) if result.stdout.strip() else {}

def main():
    subprocess.run(["npm", "ci", "--no-audit", "--no-fund"], cwd=ROOT, check=True)
    subprocess.run(["npm", "run", "build"], cwd=ROOT, check=True)
    account = aws("sts", "get-caller-identity")["Account"]
    bucket = "daymark-reminder-artifacts-" + account + "-" + REGION
    try:
        aws("s3api", "head-bucket", "--bucket", bucket)
    except RuntimeError:
        params = ["s3api", "create-bucket", "--bucket", bucket]
        if REGION != "us-east-1":
            params += ["--create-bucket-configuration", "LocationConstraint=" + REGION]
        aws(*params)
        aws("s3api", "put-public-access-block", "--bucket", bucket, "--public-access-block-configuration",
            "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true")
    bundle = ROOT / "build/function.zip"
    with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(ROOT / "build/index.js", "index.js")
    key = "function-" + hashlib.sha256(bundle.read_bytes()).hexdigest() + ".zip"
    aws("s3api", "put-object", "--bucket", bucket, "--key", key, "--body", str(bundle), "--server-side-encryption", "AES256")
    existing = False
    try:
        stack = aws("cloudformation", "describe-stacks", "--stack-name", STACK)["Stacks"][0]
        existing = True
        keys = aws("lambda", "get-function-configuration", "--function-name", STACK)["Environment"]["Variables"]
        public_key, private_key = keys["VAPID_PUBLIC_KEY"], keys["VAPID_PRIVATE_KEY"]
    except RuntimeError:
        generated = subprocess.check_output(["node", "-e", "process.stdout.write(JSON.stringify(require('web-push').generateVAPIDKeys()))"], cwd=ROOT, text=True)
        keys = json.loads(generated)
        public_key, private_key = keys["publicKey"], keys["privateKey"]
    template = subprocess.check_output(["node", "template.cjs"], cwd=ROOT, text=True)
    parameters = [
        {"ParameterKey": k, "ParameterValue": v}
        for k,v in {"CodeBucket":bucket,"CodeKey":key,"PublicKey":public_key,"PrivateKey":private_key,"AllowedOrigins":ORIGINS}.items()
    ]
    request = {"StackName":STACK,"TemplateBody":template,"Parameters":parameters,"Capabilities":["CAPABILITY_IAM"]}
    verb = "update-stack" if existing else "create-stack"
    try:
        aws("cloudformation", verb, "--cli-input-json", "file:///dev/stdin", data=request)
    except RuntimeError as error:
        if "No updates are to be performed" not in str(error): raise
    else:
        print("Waiting for the reminder stack.", flush=True)
        aws("cloudformation","wait", "stack-update-complete" if existing else "stack-create-complete", "--stack-name", STACK)
    outputs = aws("cloudformation", "describe-stacks", "--stack-name", STACK)["Stacks"][0]["Outputs"]
    values = {entry["OutputKey"]:entry["OutputValue"] for entry in outputs}
    config = {"api":values["ApiUrl"],"publicKey":values["PublicKey"]}
    (ROOT.parents[1] / "dist/reminder-config.js").write_text("window.DAYMARK_REMINDERS = " + json.dumps(config) + ";\n")
    print("Reminder API deployed. The browser configuration was updated.", flush=True)

if __name__ == "__main__":
    main()
