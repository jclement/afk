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
  it("renders a REQUEST with the expected envelope", () => {
    const ics = buildInviteIcs({
      user,
      vacation,
      category: cat,
      organizerEmail: "afk@mg.example.com",
      method: "REQUEST",
      sequence: 0,
      appOrigin: "https://afk.example.com",
    });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("UID:v1@afk");
    expect(ics).toContain("SEQUENCE:0");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260504");
    // DTEND is exclusive — the day after the last vacation day.
    expect(ics).toContain("DTEND;VALUE=DATE:20260509");
    expect(ics).toContain("ORGANIZER;CN=AFK:mailto:afk@mg.example.com");
    expect(ics).toContain("ATTENDEE");
    expect(ics).toContain("alice@example.com");
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
      method: "REQUEST",
      sequence: 0,
      appOrigin: "https://afk.example.com",
    });
    // commas and semicolons must be backslash-escaped per RFC 5545
    expect(ics).toContain("Conf\\, party\\; the works");
    // newlines become \n literal
    expect(ics).toContain("Day 2");
  });
});
