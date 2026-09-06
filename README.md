# n8n-nodes-justfill

Fill existing PDF forms from n8n data — including **scanned and flattened PDFs**
that have no form fields at all.

You set the layout up **once**, visually, with the
[JustFill n8n setup guide](https://justfill.app/integrations/n8n-fill-pdf-forms?utm_source=github&utm_medium=referral&utm_campaign=b2b_pdf_automation_2026q3&utm_content=n8n_node_readme).
This node then fills that form for every item flowing through your workflow: a
spreadsheet row, a CRM record, a webhook payload. No re-detection per run: the
node fills the source PDF instead of generating a new document from HTML.
Check a saved sample in the PDF viewer your recipients use before running a batch.

Want to inspect a complete workflow before installing the node? Start with the
[current workflow JSON from GitHub](https://github.com/mrmaciej1/justfill-mcp/blob/main/examples/n8n/fill-pdf-workflow.json).
It accepts a PDF and JSON, maps values to reviewed field names, fills the
existing document, and returns a temporary download link.

The catalog update for template 17274 was submitted on September 5, 2026 and
is under review. Use the repository file until the updated template is published.

## Installation

This community-node installation requires **self-hosted n8n**. The package is
not yet verified for n8n Cloud. As of September 6, 2026, the Creator Portal
still lists version 0.1.3 as `Awaiting Video`; the current npm package is 0.1.5.
The node submission is separate from the workflow-template review above.

Settings → **Community Nodes** → Install → `n8n-nodes-justfill`

If your source is already Excel or CSV and you do not need n8n yet, use the
[guided five-row PDF mail merge sample](https://justfill.app/solutions/fill-pdf-from-excel?utm_source=github&utm_medium=referral&utm_campaign=b2b_pdf_automation_2026q3&utm_content=n8n_node_readme_excel_batch)
to verify one-filled-PDF-per-row output first.

## Credentials

Create an API key at justfill.app → **Account → API keys**. It starts with
`jf_live_` and does not expire.

## Operations

### List Fields

Give it a PDF; it returns the saved layout's fields in `$json.fields`.
The JSON for each output item looks like this (the hash is illustrative):

```json
{
  "contentHash": "0123456789abcdef0123456789abcdef",
  "fields": [
    { "name": "Patient name", "id": "f_name", "page": 1, "type": "text" },
    { "name": "Date", "id": "f_date", "page": 1, "type": "text" }
  ]
}
```

`List Fields` does **not** pass the binary PDF through. Use it to inspect the
mapping, then change the operation to `Fill PDF`, or supply the original PDF
again on a separate filling branch. Connecting its output directly to `Fill PDF`
without restoring the binary file will not work.

### Fill PDF

Each input item needs the same source PDF in the binary property selected by
`Input Binary Field` (default: `data`), plus a `Values` object keyed by field
name or ID. For a first test, use synthetic values:

```json
{ "Patient name": "Example Patient", "Date": "2026-09-06" }
```

Once the sample looks right, map the values from incoming items with n8n
expressions. Keep the source PDF attached to every item being filled.

Output: the filled PDF as binary, plus

| Field | Meaning |
| --- | --- |
| `filledFields` | number of non-empty mapped entries submitted to the API; not a visual accuracy check |
| `skippedFields` | array of unmatched input keys; with `Fail on Unknown Field` enabled, these cause an error instead |
| `outputMode` | `clean`, or `watermarked` when the account's allowance is used up |
| `watermarked` | boolean shortcut for the above |

**Check `watermarked` before delivering the file.** A successful response can
contain a watermarked PDF when the account has no clean-output allowance left.
Route that result for review instead of treating HTTP success as clean output.

## Setting up a form

1. Open the PDF once at justfill.app.
2. Review the detected fields and fix their names, positions and sizes.
3. Save it as a template.
4. Fill one sample and inspect the saved PDF, including long values and checkboxes.

The node finds that template by hashing the PDF bytes, so **the file you send
from n8n must be byte-identical** to the one you saved. Keep that original blank
file with your workflow. The same filename or download URL is not enough:
a publisher can replace the file, and re-exporting or re-compressing can change
its bytes. If the bytes change, review and save a layout for that version too.

## Notes

- Start from a blank source. Omitted, null and empty-string values are not
  submitted; do not use them to clear existing or default values in the PDF.
  Checkboxes take `"true"`, `"yes"` or `"x"`.
- `Fail on Unknown Field` is on by default. Leaving it on is how you find out
  that a column was renamed, instead of shipping a half-empty form.
- `Flatten` bakes filled native form fields into the page. Turning it off can
  retain existing editable fields, but does not create new ones on a scanned
  or flattened PDF. This node does not request the API's separate fillable-PDF
  creation mode.

## Licence

MIT
