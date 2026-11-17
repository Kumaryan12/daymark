#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

region="${AWS_REGION:-ap-south-1}"
stack="${DAYMARK_STACK:-daymark-demo}"
if [[ ! "$stack" =~ ^[A-Za-z][A-Za-z0-9-]{0,44}$ ]]; then
  echo "DAYMARK_STACK must be 1–45 characters and start with a letter." >&2
  exit 2
fi

export AWS_PAGER=''
aws sts get-caller-identity --region "$region" --output json >/dev/null
aws cloudformation deploy --region "$region" --stack-name "$stack" \
  --template-file aws/template.json --no-fail-on-empty-changeset

output() {
  aws cloudformation describe-stacks --region "$region" --stack-name "$stack" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text
}
bucket="$(output Bucket)"
distribution="$(output DistributionId)"
site="$(output SiteUrl)"

aws s3 sync dist/ "s3://$bucket/" --region "$region" --exclude '*.mjs' --exclude '*.wasm' --cache-control 'public,max-age=300' --only-show-errors
aws s3 sync dist/ "s3://$bucket/" --region "$region" --exclude '*' --include '*.mjs' --content-type 'application/javascript' --cache-control 'public,max-age=300' --only-show-errors
aws s3 sync dist/ "s3://$bucket/" --region "$region" --exclude '*' --include '*.wasm' --content-type 'application/wasm' --cache-control 'public,max-age=300' --only-show-errors
invalidation="$(aws cloudfront create-invalidation --distribution-id "$distribution" \
  --paths '/*' --query 'Invalidation.Id' --output text)"
aws cloudfront wait invalidation-completed --distribution-id "$distribution" --id "$invalidation"
html="$(curl -fsSL --retry 3 "$site")"
grep -q 'Daymark' <<<"$html"
curl -fsSL --retry 3 "${site}assets/vendor/ocr/eng.traineddata.gz" -o /dev/null
curl -fsSL --retry 3 -I "${site}assets/vendor/pdf/pdf.worker.min.mjs" | grep -qi '^content-type: application/javascript'
printf '\nDaymark verified at %s\n' "$site"
