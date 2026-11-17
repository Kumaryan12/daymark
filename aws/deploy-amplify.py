#!/usr/bin/env python3
"""Publish Daymark's static assets with a manual AWS Amplify Hosting deployment."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REGION = os.environ.get("AWS_REGION", "ap-south-1")
APP_NAME = "daymark-techfest"
BRANCH = "main"

def amplify(*args, query):
    cmd = ["aws", "amplify", *args, "--region", REGION, "--query", query, "--output", "json", "--no-cli-pager"]
    return json.loads(subprocess.check_output(cmd, text=True))

def main():
    apps = amplify("list-apps", query=f"apps[?name=='{APP_NAME}'].{{id:appId,domain:defaultDomain}}")
    if len(apps) > 1:
        raise SystemExit("Several Amplify apps have the Daymark name. Identify the target before deploying.")
    app = apps[0] if apps else amplify(
        "create-app", "--name", APP_NAME, "--platform", "WEB",
        "--description", "Daymark static prototype for the Techfest Campus to Cloud Hackathon",
        query="app.{id:appId,domain:defaultDomain}",
    )
    app_id = app["id"]
    branches = amplify("list-branches", "--app-id", app_id, query="branches[].branchName")
    if BRANCH not in branches:
        amplify("create-branch", "--app-id", app_id, "--branch-name", BRANCH, "--stage", "PRODUCTION",
                "--no-enable-auto-build", "--no-enable-basic-auth", query="branch.branchName")

    with tempfile.TemporaryDirectory() as temp:
        archive = Path(temp) / "daymark.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
            for item in sorted((ROOT / "dist").rglob("*")):
                if item.is_file() and item.name != ".DS_Store":
                    zipped.write(item, item.relative_to(ROOT / "dist"))
        deployment = amplify("create-deployment", "--app-id", app_id, "--branch-name", BRANCH,
                             query="{job:jobId,upload:zipUploadUrl}")
        try:
            request = urllib.request.Request(deployment["upload"], data=archive.read_bytes(), method="PUT")
            with urllib.request.urlopen(request, timeout=90):
                pass
        except (urllib.error.HTTPError, urllib.error.URLError) as error:
            raise SystemExit(f"Amplify archive upload failed ({getattr(error, 'code', type(error).__name__)}).") from None

    job = deployment["job"]
    amplify("start-deployment", "--app-id", app_id, "--branch-name", BRANCH, "--job-id", job,
            query="jobSummary.status")
    print(f"Amplify job {job} started in {REGION}.", flush=True)
    deadline = time.monotonic() + 600
    previous_status = None
    while time.monotonic() < deadline:
        result = amplify("get-job", "--app-id", app_id, "--branch-name", BRANCH, "--job-id", job,
                         query="job.{status:summary.status,steps:steps[].{name:stepName,status:status}}")
        status = result["status"]
        if status != previous_status:
            print(f"Amplify job {job}: {status}", flush=True)
            previous_status = status
        if status == "SUCCEED":
            print(f"https://{BRANCH}.{app['domain']}/", flush=True)
            return
        if status in {"FAILED", "CANCELLED"}:
            print(json.dumps(result["steps"]), flush=True)
            raise SystemExit("Amplify hosting job did not complete.")
        time.sleep(8)
    raise SystemExit(f"Amplify job {job} is still running.")

if __name__ == "__main__":
    main()
