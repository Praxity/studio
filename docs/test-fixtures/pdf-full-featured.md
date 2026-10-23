`pdf-full-featured.prax` is the static workbook version of the public grammar 4
`full-featured.prax` example. The public example includes a runtime rule that shows
remediation when `passedCheckpoint` is false. This fixture fixes that initial
state: remediation is visible and the runtime rule is absent.

The native PDF test checks that the dynamic source is rejected, then exports this
fixture in A4 and Letter, with and without answers. All nine questions, content
markers, and document structure assertions remain in that test.
