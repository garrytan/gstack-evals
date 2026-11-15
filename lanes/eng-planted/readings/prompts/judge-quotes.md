You are reading the planning material a developer was given before implementing a change in an existing code base: a plan, and possibly a reviewer's notes on it.

List the concrete conditions the material commits the developer to handle or to test. A concrete condition names a specific input, state or situation and what the code must do in it, for example "when the list is empty, return null" or "test that a closed connection raises an error". A general instruction such as "handle edge cases", "validate inputs", "handle errors" or "add tests" is not a concrete condition: leave it out.

Quote each condition exactly as it is written in the material, copying one sentence or less. List at most {{MAX}} conditions, in the order they appear. If the material commits to none, give an empty list.

Answer with a JSON array of strings and nothing else.

<material>
{{BUNDLE}}
</material>
