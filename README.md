# n8n-nodes-justfill

Fill existing PDF forms from n8n data — including **scanned and flattened PDFs**
that have no form fields at all.

You set the layout up **once**, visually, with the
[JustFill n8n setup guide](https://justfill.app/integrations/n8n-fill-pdf-forms?utm_source=github&utm_medium=referral&utm_campaign=b2b_pdf_automation_2026q3&utm_content=n8n_node_readme).
This node then fills that form for every item flowing through your workflow: a
spreadsheet row, a CRM record, a webhook payload. No re-detection per run, and
the original PDF is never rebuilt — layout, fonts and pagination stay exactly as
they were.

Want to inspect a complete workflow before installing the node? Start with the
[free reviewed template in the official n8n catalog](https://n8n.io/workflows/17274-fill-pdf-forms-from-json-data-with-justfill-and-a-form-trigger/).
It accepts a PDF and JSON, maps values to reviewed field names, fills the
existing document, and returns a temporary download link.

## Installation

Settings → **Community Nodes** → Install → `n8n-nodes-justfill`

If your source is already Excel or CSV and you do not need n8n yet, use the
[guided five-row PDF mail merge sample](https://justfill.app/solutions/fill-pdf-from-excel?utm_source=github&utm_medium=referral&utm_campaign=b2b_pdf_automation_2026q3&utm_content=n8n_node_readme_excel_batch)
to verify one-filled-PDF-per-row output first.

## Credentials

Create an API key at justfill.app → **Account → API keys**. It starts with
`jf_live_` and does not expire.

## Operations

### List Fields

Give it a PDF; it returns the field names of the saved layout. Use this once to
see what you can map onto.

```
[ { "name": "Patient name", "id": "f_name", "page": 1, "type": "text" },
  { "name": "Date",         "id": "f_date", "page": 1, "type": "text" } ]
```

### Fill PDF

Give it the same PDF plus a `Values` object keyed by those names:

```json
{ "Patient name": "{{ $json.customer }}", "Date": "{{ $now.format('yyyy-MM-dd') }}" }
```

Output: the filled PDF as binary, plus

| Field | Meaning |
| --- | --- |
| `filledFields` | how many fields received a value |
| `skippedFields` | values that matched no field |
| `outputMode` | `clean`, or `watermarked` when the account's allowance is used up |
| `watermarked` | boolean shortcut for the above |

**Check `watermarked`.** When an account runs out of clean output pages the API
still returns a perfectly valid PDF — with a watermark. Without branching on
this, a workflow will happily deliver watermarked documents to customers and
nothing will look broken.

## Setting up a form

1. Open the PDF once at justfill.app.
2. Review the detected fields and fix any that are off — this is the step that
   makes every later run exact.
3. Save it as a template.

The node finds that template by hashing the PDF bytes, so **the file you send
from n8n must be byte-identical** to the one you saved. Re-downloading the same
blank form from the same source is fine; re-exporting or re-compressing it is
not, because that changes the bytes and no template will match.

## Notes

- Fields you omit stay empty; checkboxes take `"true"`, `"yes"` or `"x"`.
- `Fail on Unknown Field` is on by default. Leaving it on is how you find out
  that a column was renamed, instead of shipping a half-empty form.
- `Flatten` bakes the values into the page. Turn it off to keep the result
  editable.

## Licence

MIT
