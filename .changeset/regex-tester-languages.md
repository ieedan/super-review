---
'@super-review/desktop': minor
'@super-review/ui': minor
---

feat: find regexes in C#, Python, Java, Kotlin, Go, Rust and PHP

The inline regex tester only understood JavaScript's `/pattern/flags`. Every
other language writes a regex as a string handed to a function, so detection
there is about position rather than syntax: `re.compile(…)`,
`Pattern.compile(…)`, `regexp.MustCompile(…)`, `new Regex(…)`, `preg_match(…)`
and friends. Every other string in the file stays inert, which is the harder
half of the job in files that are mostly strings.

That shape is the same in all of them, so it is one scanner driven by a table
per language: which calls hold a pattern and where, how the language spells a
string, and how its flags translate. Patterns are decoded to the value the
engine would receive, so `"\\d+"` is tested as `\d+`, and PHP's `'/^a$/i'`
is unwrapped into a pattern and its flags.

Patterns still run on the browser's engine, which is the real one only for
JavaScript. Where the two agree, which is nearly always, the popup says
nothing. Where they don't it adds a line, because the quiet differences are the
dangerous ones: `\A` is an anchor in most of these languages and a literal "A"
here, so a pattern using it would otherwise report "No match" and look simply
broken. A leading `(?i)` is lifted into a real flag instead, since that is how
Go and Rust spell flags at all.
