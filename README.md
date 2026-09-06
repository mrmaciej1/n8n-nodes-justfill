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

[Watch the 74-second uncut walkthrough](https://github.com/mrmaciej1/n8n-nodes-justfill/releases/download/v0.1.5/justfill-n8n-complete-walkthrough.webm):
install 0.1.5, test a new masked credential, list fields, fill and open a synthetic
PDF, then let AI Agent **2.2** call the field-listing tool with a local CPU model.
The agent example was prepared before recording. This is a working demonstration,
not n8n approval; the portal version update remains pending.

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

## Using List Fields as an AI tool

Start from the [AI Agent 3.1 example](examples/ai-agent-list-fields.json).
Import it into self-hosted n8n, follow its setup note, then select your own
JustFill and local Ollama credentials. The example contains no keys or pinned
results and only lists saved fields; it does not generate or deliver PDFs.

Keep the workflow execution order at **v1**. If you create workflow JSON or
use the REST API, set this explicitly:

```json
{ "settings": { "executionOrder": "v1" } }
```

On n8n 2.34.4, omitted settings select the legacy execution order. In our
Agent 3.1 test that resumed the agent before its JustFill tool had finished,
so the answer reported an empty result despite correct tool output.

A tool call does not automatically receive the agent's binary input. Leaving
`Input Binary Field` at `data` can fail even when the PDF is visible in the
agent's preceding step. In the tool, switch that parameter to **Expression**
and reference the node that downloaded the original PDF:

```javascript
{{ $('Synthetic PDF').item.binary.data }}
```

Replace `Synthetic PDF` and `data` with your actual node and binary-property
names. This passes the binary object to n8n's binary helper; it is not a URL,
base64 text or an AI-generated file reference. Keep the source selection under
workflow control, not `$fromAI()`.

The following **single-PDF** setup was tested on September 6, 2026:

- Self-hosted n8n **2.34.4**, JustFill package **0.1.5**, AI Agent node
  **3.1** with **executionOrder: v1**; the earlier video uses node **2.2**
  (`typeVersion` in workflow JSON).
- Manual Trigger → HTTP Request (file response) → AI Agent, with JustFill
  connected as a tool, operation `List Fields`, using the expression above.
- Tool name `list_pdf_fields`; manual description:
  `Read the saved field names of the attached supplier intake PDF.`
- Local Ollama **0.33.1**, `qwen3:0.6b`, thinking off, temperature 0,
  context 2048, maximum 256 output tokens. No cloud model was used.
- Agent system message: `You are a helpful assistant.` Prompt:
  `List the field names of the attached supplier intake PDF. Use the list_pdf_fields tool. Do not guess field names.`

The execution trace contained a real tool call, the three saved field names in
its observation, and the same names in the agent's answer. Earlier prompts
returned text or an empty array without invoking the tool: a green workflow
status alone is not enough. Check the tool execution and observation.

**Correction, September 6:** the earlier Agent 3.1 warning was too broad.
An omitted-settings control reproduced the empty observation. Two fresh 3.1
executions with `executionOrder: "v1"` both received the exact tool result and
returned all three field names. The node package and n8n runtime were unchanged;
no downgrade or core patch was needed. This matches the scheduling issue
described in [n8n #26202](https://github.com/n8n-io/n8n/issues/26202), which is
closed as not reproduced, not marked fixed. Do not change a production
workflow's execution order without checking its other branches too.
Multi-item agent workflows have not been validated by this single-PDF check.

This example lists fields; it does not demonstrate agent-driven PDF delivery.
Use ordinary workflow nodes for filling and handling the binary PDF output.
The walkthrough linked above includes this scoped tool action alongside ordinary
PDF filling. That video still demonstrates Agent 2.2; the later 3.1 comparison
is separate execution evidence, not a replacement video or n8n approval.

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
