---
'@super-review/desktop': minor
'@super-review/ui': minor
---

feat: find regexes in C#, Python, Java, Kotlin, Go, Rust, PHP and Ruby

The inline regex tester only understood JavaScript's `/pattern/flags`. Ruby has
literals of its own (`/…/` and `%r{…}`, with the same division-or-regex question
JavaScript poses) and gets its own scanner. Every other language writes a regex
as a string handed to a function, so detection there is about position rather
than syntax: `re.compile(…)`,
`Pattern.compile(…)`, `regexp.MustCompile(…)`, `new Regex(…)`, `preg_match(…)`
and friends. Every other string in the file stays inert, which is the harder
half of the job in files that are mostly strings.

That shape is the same in all of them, so it is one scanner driven by a table
per language: which calls hold a pattern and where, how the language spells a
string, and how its flags translate. Patterns are decoded to the value the
engine would receive, so `"\\d+"` is tested as `\d+`, and PHP's `'/^a$/i'`
is unwrapped into a pattern and its flags.

Patterns still run on the browser's engine, which is the real one only for
JavaScript, so two things are brought over where that can be done exactly. A
leading `(?i)` becomes a real flag, since that is how Go and Rust spell flags at
all. And `\A` / `\z`, which anchor nearly every Ruby validation and which this
engine reads as literal letters, become `^` and `$`, which is what they mean
when the subject is a single line and the tester's input is exactly that.

For what is left, the popup adds a line. It says nothing when the pattern means
the same thing in both engines, which is nearly always.
