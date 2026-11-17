# Daymark

Daymark turns a bill, screenshot, or forwarded message into an action with a date, any amount mentioned, and the original wording next to it. It is designed for people who have to piece together everyday obligations across different apps.

## Idea brief

**Problem.** Deadlines can be buried in a forwarded message, a PDF attachment, and a second message that changes the first. Even when someone finds the original notice, they still need to determine what to do and whether that instruction is current.

**Product.** Import a notice and check the extracted action, date, amount, sender and reference. Save it to your action plan. When another notice from the same sender and reference changes an action, Daymark shows both versions and waits for your decision. The earlier source stays available after review. You can track completion and export reviewed dates to your calendar.

**Potential impact.** A pilot can give participants the same fictional bundle of bills, school messages and revised deadlines with and without Daymark. Compare time to build the action plan, missed or incorrect deadlines, and how often participants choose the latest applicable notice. The prototype has no measured pilot impact.

## Run the full app

From this folder:

```sh
python3 -m http.server 8766 --directory dist
```

Open http://localhost:8766. All OCR and PDF engines are bundled and loaded on demand. The downloadable standalone HTML supports pasted text and TXT files. Use the served app for screenshots and PDFs.

For a quick demo, choose **Review change** on the sample housing maintenance bill. Compare the two dates and the original wording. Apply the proposed date, open the action to see its source history, and export the calendar. **Try a sample notice** walks through extraction and review. Use **Data & privacy** to remove the sample actions.

## Build summary

- **Browser architecture.** Tesseract.js reads English text from PNG, JPG and WEBP images. PDF.js extracts text from PDFs and renders image-only pages for OCR. The app handles files up to 15 MB and PDFs up to 12 pages. Extraction and comparisons run in the browser.
- **Review rules.** The parser recognizes common English action phrases and Indian day-month-year formats. It asks for a date when the copy says “tomorrow,” gives competing dates, or omits the year. It can suggest several actions in a notice and matches revisions using sender and reference. Users review every import before saving. Calendar entries are all-day and skip actions awaiting a decision on a changed notice.
- **Data.** The browser stores actions and extracted text in local storage. No account or shared database is required. The site limits its network requests to its own origin and serves the OCR and PDF engines from that origin. People using the same browser profile can see its saved plan.
- **AWS.** CloudFront serves the site and distributes the on-demand OCR/PDF assets. The S3 bucket is private. Origin Access Control signs requests from the distribution, and CloudFront sets browser security headers. CloudFormation makes this setup reproducible.

## Deploy to AWS

With AWS CLI v2 and a current sign-in for your intended AWS account, run:

```sh
aws login
bash aws/deploy.sh
```

It defaults to Mumbai (`ap-south-1`). Set `AWS_REGION` or `DAYMARK_STACK` to override. The script creates or updates the stack, uploads the assets with the correct JavaScript and WASM content types, invalidates the cache, and prints the hosted URL after smoke checks. Initial CloudFront provisioning can take several minutes. Confirm the account’s plan and usage allowances before deployment. To clean up after the demo, empty the S3 bucket and delete the CloudFormation stack.

The CloudFormation template passed local validation. A live AWS smoke test requires an authenticated AWS session.

## Dependencies and assets

- [Tesseract.js](https://github.com/naptha/tesseract.js), [English LSTM model](https://github.com/tesseract-ocr/tessdata_fast), and [PDF.js](https://github.com/mozilla/pdf.js). Licenses are in the vendor directories.
- Geist and Instrument Serif use the included SIL Open Font Licenses.
- [CloudFront signed access to S3](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html).

The photograph at `dist/assets/notices.jpg` was generated with the built-in ImageGen tool:

> Create a photorealistic wide horizontal editorial photograph for the right side of a refined personal productivity website hero, banner ratio about 2.5:1. Dim forest-green workspace lit by afternoon window light from the right. On the RIGHT half, an overhead three-quarters view of a small set of overlapping cream paper envelopes and printed notices with intentionally illegible tiny type, a face-up graphite smartphone with a black inactive screen, and one simple metal paperclip. They sit on a dark pine green tabletop. Beautiful warm directional reflections, subtle analogue grain, editorial lifestyle photography, substantial real object texture. Leave left 40% bare and dark pine green so dark green text backdrop can blend seamlessly. Avoid readable text, brands, hands, pencils and excess props. The image should convey neglected everyday paperwork calmly, like a sophisticated lifestyle brand campaign.
