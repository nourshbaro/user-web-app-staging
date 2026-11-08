import assert from "node:assert/strict";
import test from "node:test";
import { parseLegalDocument } from "./legalDocument.ts";

const plain = (text) => [{ text, strong: false }];

test("headings, paragraphs and bold labels keep their structure", () => {
  const html = `<h2>4. Prices and Payment</h2>

<p>
  <strong>Ticket Prices and Fees:</strong> All ticket prices shall be
  displayed in the applicable currency.
</p>`;
  assert.deepEqual(parseLegalDocument(html), [
    { kind: "heading", runs: plain("4. Prices and Payment") },
    {
      kind: "paragraph",
      runs: [
        { text: "Ticket Prices and Fees:", strong: true },
        { text: " All ticket prices shall be displayed in the applicable currency.", strong: false },
      ],
    },
  ]);
});

test("ordered and unordered lists become list blocks with one entry per item", () => {
  const html = `<p>Steps:</p>
<ol>
  <li>Select a Match: Choose the
    football match.</li>
  <li>Select Tickets</li>
</ol>
<ul><li>Email: info@lfa-ticketing.com</li></ul>`;
  assert.deepEqual(parseLegalDocument(html), [
    { kind: "paragraph", runs: plain("Steps:") },
    { kind: "list", ordered: true, items: [plain("Select a Match: Choose the football match."), plain("Select Tickets")] },
    { kind: "list", ordered: false, items: [plain("Email: info@lfa-ticketing.com")] },
  ]);
});

test("entities are decoded, line breaks kept, and scripts or comments never shown as tags", () => {
  const html = "<p>A&nbsp;&amp;&#39;B&#x2019; &rsquo;<br/>next line</p><!-- note --><p><em>x</em> &lt;y&gt;</p>";
  assert.deepEqual(parseLegalDocument(html), [
    { kind: "paragraph", runs: plain("A &'B’ ’\nnext line") },
    { kind: "paragraph", runs: plain("x <y>") },
  ]);
});

test("nested lists flatten into the outer list; text outside tags is a paragraph", () => {
  const html = "Intro text<ul><li>One<ul><li>One-a</li></ul></li><li>Two</li></ul>";
  assert.deepEqual(parseLegalDocument(html), [
    { kind: "paragraph", runs: plain("Intro text") },
    { kind: "list", ordered: false, items: [plain("One"), plain("One-a"), plain("Two")] },
  ]);
});

test("plain-text documents split into paragraphs on blank lines", () => {
  assert.deepEqual(parseLegalDocument("First line\nsame paragraph\n\n  Second  \n\n\n"), [
    { kind: "paragraph", runs: plain("First line\nsame paragraph") },
    { kind: "paragraph", runs: plain("Second") },
  ]);
});
