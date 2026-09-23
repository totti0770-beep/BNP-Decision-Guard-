/**
 * The body that sets or clears a document's issuing authority through
 * `PATCH /documents/:id`.
 *
 * Trimmed here because the API's update path, unlike upload, stores what it
 * is given: whitespace would otherwise be saved as a provenance value that
 * renders as blank. An empty string is sent rather than omitted, because the
 * API reads an empty value as "clear" and an absent one as "leave alone".
 *
 * Nothing here suggests a value. A title prefix such as "JSH-" looks like it
 * names the issuing body, and the field exists precisely so that nobody has
 * to guess.
 */
export function issuingAuthorityPatch(value: string): { issuingAuthority: string } {
  return { issuingAuthority: value.trim() };
}
