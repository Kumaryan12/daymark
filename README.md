# Daymark

Daymark turns a bill, screenshot, or forwarded message into an action with a date, any amount mentioned, and the original wording next to it. It is designed for people who have to piece together everyday obligations across different apps.

**Live AWS prototype** [Open Daymark](https://main.d1xsxokyfc76bs.amplifyapp.com/)

## Idea brief

**Problem.** Deadlines can be buried in a forwarded message, a PDF attachment, and a second message that changes the first. Even when someone finds the original notice, they still need to determine what to do and whether that instruction is current.

**Product.** Import a notice and check the extracted action, date, amount, sender and reference. Save it to your action plan. Daymark suggests related actions using the sender, topic, amount, dates and reference when present. Choose the action a follow-up belongs to, compare both versions, and approve any change. Older dated notices go into source history. The earlier source stays available after review. You can track completion and export reviewed dates to your calendar.

**Potential impact.** A pilot can give participants the same fictional bundle of bills, school messages and revised deadlines with and without Daymark. Compare time to build the action plan, missed or incorrect deadlines, and how often participants choose the latest applicable notice. The prototype has no measured pilot impact.

## Run the full app

From this folder:

```sh
python3 -m http.server 8766 --directory dist
```

Open http://localhost:8766. All OCR and PDF engines are bundled and loaded on demand. The downloadable standalone HTML supports pasted text and TXT files. Use the served app for screenshots and PDFs.

For a quick demo, start with **Try deadline replay**. A college notice is followed by “Guys, semester fees extended to Friday.” Review the sender, topic and message-date evidence and choose which date to use. The walkthrough runs separately from your plan. The **Week ahead** calendar shows saved deadlines in green and proposed dates in amber. Select a day to view the matching actions.

To try the same decision in your plan, choose **Review change** on the sample housing maintenance bill. Compare the two dates and the original wording. Apply the proposed date, open the action to see its source history, and export the calendar. **Try a sample notice** walks through extraction and review. Use **Data & privacy** to remove the sample actions.

## Build summary

- **Browser architecture.** Tesseract.js reads English text from PNG, JPG and WEBP images. PDF.js extracts text from PDFs and renders image-only pages for OCR. The app handles files up to 15 MB and PDFs up to 12 pages. Extraction and comparisons run in the browser.
- **Review rules.** The parser recognizes common English action phrases and Indian day-month-year formats. A user-supplied original message timestamp anchors relative words such as “Friday” and “tomorrow”. The interpretation is shown for review. Matching suggestions explain shared senders, topics, references and amounts. Ambiguous matches require the user to choose an action. Source timestamps and saved history prevent an old notice from silently replacing a newer one. Users review every import before saving. Calendar entries are all-day and skip actions awaiting a decision on a changed notice.
- **Data.** The browser stores actions and extracted text in local storage. No account or shared database is required. OCR and PDF engines are served from the app origin. Enabling device reminders additionally sends the selected task titles, reminder times and browser push subscription to the AWS reminder API. Full notice text stays in the browser. People using the same browser profile can see its saved plan.
- **AWS.** AWS Amplify Hosting serves the public site and its on-demand OCR and PDF assets over HTTPS. The checked-in deployment script packages the static build, uploads it to Amplify, and monitors the release.

## Deploy to AWS

With AWS CLI v2, Python 3.10 or newer, and an authenticated AWS CLI profile:

```sh
aws login
python3 aws/deploy-amplify.py
```

The script defaults to Mumbai (`ap-south-1`). Set `AWS_REGION` or `AWS_PROFILE` to use another region or authenticated profile. It creates or reuses the Daymark Amplify app and its `main` branch, uploads a ZIP of `dist/`, and watches the deployment job. The last output line is the public URL.

The repository also includes a private S3 and CloudFront template for accounts eligible to create CloudFront distributions. The live prototype uses Amplify Hosting.

## Dependencies and assets

- [Tesseract.js](https://github.com/naptha/tesseract.js), [English LSTM model](https://github.com/tesseract-ocr/tessdata_fast), and [PDF.js](https://github.com/mozilla/pdf.js). Licenses are in the vendor directories.
- Geist and Instrument Serif use the included SIL Open Font Licenses.
- [AWS Amplify Hosting manual deploys](https://docs.aws.amazon.com/amplify/latest/userguide/manual-deploys.html).

The photograph at `dist/assets/notices.jpg` was generated with the built-in ImageGen tool:

> Create a photorealistic wide horizontal editorial photograph for the right side of a refined personal productivity website hero, banner ratio about 2.5:1. Dim forest-green workspace lit by afternoon window light from the right. On the RIGHT half, an overhead three-quarters view of a small set of overlapping cream paper envelopes and printed notices with intentionally illegible tiny type, a face-up graphite smartphone with a black inactive screen, and one simple metal paperclip. They sit on a dark pine green tabletop. Beautiful warm directional reflections, subtle analogue grain, editorial lifestyle photography, substantial real object texture. Leave left 40% bare and dark pine green so dark green text backdrop can blend seamlessly. Avoid readable text, brands, hands, pencils and excess props. The image should convey neglected everyday paperwork calmly, like a sophisticated lifestyle brand campaign.

## Phone capture and offline use

Install Daymark using your browser’s Install app or Add to Home Screen command. On supported Android Chromium browsers, Daymark appears in the system Share menu for text, screenshots and PDFs. The service worker handles the incoming share locally and opens it for review. On iPhone, use the upload and paste controls inside Daymark. The app shell is cached for offline use. OCR assets are loaded on demand and need a connection for first use.

## Reminders

Open **Reminders**, enable notifications, select actions, and choose their due-date reminder times. Times follow the timezone on the device where you save the schedule. Approving a changed due date updates the selected reminder. Completing or removing an action removes it from this device’s server schedule. A pending correction retains the saved date until you approve it.

The service uses an API Gateway HTTP API, Lambda, provisioned DynamoDB and an EventBridge rule every minute. Each device uses a random bearer token, whose hash identifies its schedule. The server stores push subscriptions and selected action titles/times until seven days after the latest queued reminder, with a minimum retention of 90 days after the last update. Use **Disable on this device** to remove the schedule. Browser data removal can discard the local token while leaving the server record until it expires.

Web Push requires browser and OS notification permission. iOS/iPadOS require a Home Screen-installed app with push support. Delivery timing depends on the network, notification settings and push provider. Updates made offline sync when the app reconnects. Notifications already in transit can still arrive after a last-moment change.

To deploy the reminder backend, install Node dependencies and Python’s boto3 in your environment, then run:

```sh
python3 -m pip install boto3
python3 aws/reminders/deploy.py
python3 aws/deploy-amplify.py
```

Use the same AWS_PROFILE and AWS_REGION as your frontend. The script preserves existing VAPID keys on updates and writes only the public configuration into the browser build. API origins are listed in the deployment script.

## Regression checks

```sh
node tests/model.test.cjs
node tests/reminders.test.cjs
```

These cover corrections without references, ambiguous candidates, relative dates, historical imports and reminder dispatch with a simulated push provider. Browser and live AWS checks also verified share-target text/file handling, mobile layouts, API schedule replacement and removal. Push delivery on a physical phone requires an opt-in test on that device.

### Additional primary references

- [Chrome share targets](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target)
- [Web Push on Apple Home Screen web apps](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
