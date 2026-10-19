import { afterEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "../../apps/web/src/types";
import { csvFilename, downloadCsv, leadsToCsv, toCsv } from "../../apps/web/src/lib/csv";
import { parseCsv } from "../../apps/web/src/lib/csvParse";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("parseCsv", () => {
  it("parses simple comma-separated rows", () => {
    expect(parseCsv("name,email\nAsha,asha@example.com\nRavi,ravi@example.com")).toEqual([
      ["name", "email"],
      ["Asha", "asha@example.com"],
      ["Ravi", "ravi@example.com"],
    ]);
  });

  it("handles CRLF, CR-only and trailing newlines", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a,b\r1,2\r")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles quoted delimiters, escaped quotes and quoted newlines", () => {
    expect(parseCsv('name,notes\n"Rao, Asha","She said ""hi""\nthen left"\n')).toEqual([
      ["name", "notes"],
      ["Rao, Asha", 'She said "hi"\nthen left'],
    ]);
  });

  it("keeps empty fields, including quoted and trailing ones", () => {
    expect(parseCsv('a,b,c\n"",,x\n1,2,')).toEqual([
      ["a", "b", "c"],
      ["", "", "x"],
      ["1", "2", ""],
    ]);
  });

  it("treats quotes inside an unquoted field literally", () => {
    expect(parseCsv('a,b\n5" screen,ok')).toEqual([
      ["a", "b"],
      ['5" screen', "ok"],
    ]);
  });

  it("reads an unterminated quoted field to the end", () => {
    expect(parseCsv('a\n"open field')).toEqual([["a"], ["open field"]]);
  });

  it("detects semicolon and tab delimiters from the header", () => {
    expect(parseCsv("name;email;phone\nAsha;a@b.com;123")).toEqual([
      ["name", "email", "phone"],
      ["Asha", "a@b.com", "123"],
    ]);
    expect(parseCsv("name\temail\nAsha, R\ta@b.com")).toEqual([
      ["name", "email"],
      ["Asha, R", "a@b.com"],
    ]);
  });

  it("ignores delimiters inside quoted header cells when detecting the delimiter", () => {
    expect(parseCsv('Name;"City, State"\nAsha;"Mysuru, KA"')).toEqual([
      ["Name", "City, State"],
      ["Asha", "Mysuru, KA"],
    ]);
  });

  it("strips a UTF-8 BOM", () => {
    expect(parseCsv("\uFEFFname,email\nA,b")[0]).toEqual(["name", "email"]);
  });

  it("drops blank and whitespace-only rows", () => {
    expect(parseCsv("a,b\n\n , \n1,2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("returns no rows for empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\r\n")).toEqual([]);
  });

  it("round-trips toCsv output", () => {
    const rows = [
      ["Name", "Notes"],
      ['Rao, "Asha"', "line1\r\nline2"],
      ["", "plain"],
    ];
    expect(parseCsv(toCsv(rows[0], rows.slice(1)))).toEqual([
      ["Name", "Notes"],
      ['Rao, "Asha"', "line1\r\nline2"],
      ["", "plain"],
    ]);
  });
});

describe("toCsv", () => {
  it("joins rows with CRLF and escapes only when needed", () => {
    expect(toCsv(["a", "b"], [["x", "y,z"], ['say "hi"', "multi\nline"], ["cr\r", "ok"]])).toBe(
      'a,b\r\nx,"y,z"\r\n"say ""hi""","multi\nline"\r\n"cr\r",ok'
    );
  });

  it("renders null and undefined as empty and stringifies other values", () => {
    expect(toCsv(["n", "b", "x", "y"], [[0, false, null, undefined]])).toBe("n,b,x,y\r\n0,false,,");
  });

  it("returns only the header for no rows", () => {
    expect(toCsv(["only"], [])).toBe("only");
  });
});

describe("leadsToCsv", () => {
  const lead = (overrides: Partial<Lead> = {}): Lead =>
    ({
      id: "l1",
      name: "Asha Rao",
      title: "Student",
      company: "",
      industry: "Education",
      email: "asha@example.com",
      phone: "+91 98450 12345",
      location: "Bengaluru, KA",
      score: 82,
      status: "Hot",
      source: "Website",
      createdAt: "2026-03-02T10:00:00Z",
      ...overrides,
    }) as Lead;

  it("writes the header and one row per lead", () => {
    const csv = leadsToCsv([
      lead({ sourcePlatform: "meta", campaignName: "Spring, 2026", courseInterest: "NEET", examYear: "2027" }),
      lead({ id: "l2", name: "Ravi", email: "Not available", phone: "Not available", source: "  ", sourcePlatform: null }),
    ]);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual([
      "Name",
      "Title",
      "Company",
      "Industry",
      "Email",
      "Phone",
      "Location",
      "Score",
      "Status",
      "Source",
      "Campaign",
      "Course interest",
      "Exam year",
      "Created at",
    ]);
    expect(rows[1]).toEqual([
      "Asha Rao",
      "Student",
      "",
      "Education",
      "asha@example.com",
      "+91 98450 12345",
      "Bengaluru, KA",
      "82",
      "Hot",
      "Meta (IG/FB)",
      "Spring, 2026",
      "NEET",
      "2027",
      "2026-03-02T10:00:00Z",
    ]);
    expect(rows[2].slice(4, 6)).toEqual(["", ""]);
    expect(rows[2][9]).toBe("Other");
    expect(rows[2].slice(10, 13)).toEqual(["", "", ""]);
  });

  it("uses the Google label and trimmed free-text sources", () => {
    expect(parseCsv(leadsToCsv([lead({ sourcePlatform: "google" })]))[1][9]).toBe("Google Ads");
    expect(parseCsv(leadsToCsv([lead({ source: "  Referral " })]))[1][9]).toBe("Referral");
  });

  it("returns only the header for no leads", () => {
    expect(leadsToCsv([]).split("\r\n")).toHaveLength(1);
  });
});

describe("csvFilename", () => {
  it("appends today's UTC date", () => {
    vi.useFakeTimers({ now: new Date("2026-03-02T23:30:00Z") });
    expect(csvFilename("leads")).toBe("leads-2026-03-02.csv");
  });
});

describe("downloadCsv", () => {
  it("downloads a BOM-prefixed CSV blob and cleans up", async () => {
    const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    const appendChild = vi.fn();
    vi.stubGlobal("document", { createElement: vi.fn(() => link), body: { appendChild } });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:csv");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    downloadCsv("leads.csv", "a,b");

    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("text/csv;charset=utf-8");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toBe("\uFEFFa,b");
    expect(link.href).toBe("blob:csv");
    expect(link.download).toBe("leads.csv");
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:csv");

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });
});
