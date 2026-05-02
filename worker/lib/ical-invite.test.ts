/**
 * iCal invite builder — checks the wire format we hand to email clients.
 */

import { describe, expect, it } from "vitest";
import { buildInviteIcs } from "./ical-invite.js";
import type { Category, User, Vacation } from "../../shared/types.js";

const user: User = {
  id: "u1",
  username: "alice",
  display_name: "Alice Example",
  role: "user",
  email: "alice@example.com",
  email_verified_at: "2026-01-01",
  timezone: "UTC",
};

const cat: Category = {
  id: "c1",
  user_id: "u1",
  name: "Vacation",
  accrues: true,
  color: "#000000",
  sort_order: 0,
  archived: false,
  created_at: "2026-01-01",
};

const vacation: Vacation = {
  id: "v1",
  user_id: "u1",
  category_id: "c1",
  start_date: "2026-05-04",
  end_date: "2026-05-08",
  partial_amount: null,
  public_desc: "",
  internal_desc: "",
  cancelled_at: null,
  ical_sequence: 0,
  created_at: "2026-04-01",
  updated_at: "2026-04-01",
};

describe("buildInviteIcs", () => {
  it("renders a PUBLISH with the expected envelope and no ATTENDEE", () => {
    const ics = buildInviteIcs({
      user,
      vacation,
      category: cat,
      organizerEmail: "afk@mg.example.com",
      method: "PUBLISH",
      sequence: 0,
      appOrigin: "https://afk.example.com",
    });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics).toContain("UID:v1@afk");
    expect(ics).toContain("SEQUENCE:0");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260504");
    // DTEND is exclusive — the day after the last vacation day.
    expect(ics).toContain("DTEND;VALUE=DATE:20260509");
    expect(ics).toContain("ORGANIZER;CN=AFK:mailto:afk@mg.example.com");
    // No ATTENDEE — that's what triggers RSVP replies and bouncing.
    expect(ics).not.toContain("ATTENDEE");
    expect(ics).toContain("X-MICROSOFT-CDO-BUSYSTATUS:OOF");
    expect(ics).toContain("END:VCALENDAR");
    // RFC 5545 requires CRLF.
    expect(ics).toContain("\r\n");
  });

  it("renders a CANCEL with STATUS:CANCELLED", () => {
    const ics = buildInviteIcs({
      user,
      vacation,
      category: cat,
      organizerEmail: "afk@mg.example.com",
      method: "CANCEL",
      sequence: 1,
      appOrigin: "https://afk.example.com",
    });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("SEQUENCE:1");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("UID:v1@afk");
  });

  it("escapes special characters in DESCRIPTION", () => {
    const ics = buildInviteIcs({
      user,
      vacation: { ...vacation, public_desc: "Conf, party; the works\nDay 2" },
      category: cat,
      organizerEmail: "afk@mg.example.com",
      method: "PUBLISH",
      sequence: 0,
      appOrigin: "https://afk.example.com",
    });
    // RFC 5545 line-folding splits on 75-octet boundaries (CRLF + space),
    // so unfold before content assertions.
    const unfolded = ics.replaceAll("\r\n ", "");
    // commas and semicolons must be backslash-escaped per RFC 5545
    expect(unfolded).toContain("Conf\\, party\\; the works");
    // real newlines become literal "\n" sequences on the wire
    expect(unfolded).toContain("the works\\nDay 2");
    // there must NOT be a double-escaped "\\n" in the output (the bug
    // we just fixed: pre-escaping then escaping again)
    expect(unfolded).not.toContain("\\\\n");
  });
});
