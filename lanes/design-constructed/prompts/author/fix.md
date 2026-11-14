Two auditors checked the key of the test case below. Some items got a fix verdict, which means the item would hold after a change to its statement or detail wording alone. Their notes follow the case.

Revise only the statement and the detail of each item listed under "Items to fix", using both auditors' notes. Keep each item's class and evidence pointers. The statement stays an observed fact of at most 30 words naming the screen, component or flow, the file where it would be handled, and the condition. The detail stays the specific value, threshold, component or rule the evidence fixes, at most 12 words. Change nothing else in the case.

Output one JSON object and nothing else:
{"items": [{"id": "<item id>", "statement": "<revised statement>", "detail": "<revised detail>"}]}
Give every item listed under "Items to fix" exactly once.
