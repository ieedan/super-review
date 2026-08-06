---
'@super-review/desktop': minor
'@super-review/ui': minor
---

feat: find regexes in C#, where they are strings and not literals

The inline regex tester only understood JavaScript's `/pattern/flags`. C# has no
regex literal at all, so a pattern there is an ordinary string that happens to be
handed to `Regex`, and detection is about position rather than syntax: the
`Regex` constructor (including a target-typed `new`), the second argument of the
static `Regex` methods, and the `[GeneratedRegex]` and `[RegularExpression]`
attributes. Every other string in the file stays inert, which matters more here
than it did in JavaScript, since a C# file is mostly strings.

The pattern is the string's value rather than its source, so regular, verbatim
and single-line raw strings are decoded before anything runs them, and
`RegexOptions` becomes `RegExp` flags where one exists.

Patterns still run on the browser's engine, which is an approximation of .NET's
rather than the real thing. Where the two agree, which is nearly always, the
popup says nothing. Where they don't it adds a line: `\A` is a .NET anchor the
browser reads as a literal "A", so without that note a pattern using it would
report "No match" and look simply broken.
