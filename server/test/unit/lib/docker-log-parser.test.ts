import {describe, expect, it} from "vitest";
import {parseTimestamp, createLogEvent, processDockerLogChunk, type LogLineEvent} from "../../../src/lib/docker-log-parser.js";

describe("parseTimestamp", () => {
    it("extracts timestamp and content from log line", () => {
        const line = "2026-03-12T11:07:15.811624160Z Server running on port 5230";
        const result = parseTimestamp(line);

        expect(result.timestamp).toBe("2026-03-12T11:07:15.811624160Z");
        expect(result.content).toBe("Server running on port 5230");
    });

    it("returns content without timestamp if no timestamp present", () => {
        const line = "Server running on port 5230";
        const result = parseTimestamp(line);

        expect(result.timestamp).toBeUndefined();
        expect(result.content).toBe("Server running on port 5230");
    });

    it("handles empty lines", () => {
        const result = parseTimestamp("");

        expect(result.timestamp).toBeUndefined();
        expect(result.content).toBe("");
    });

    it("handles lines with only timestamp", () => {
        const line = "2026-03-12T11:07:15.811624160Z ";
        const result = parseTimestamp(line);

        expect(result.timestamp).toBe("2026-03-12T11:07:15.811624160Z");
        expect(result.content).toBe("");
    });
});

describe("createLogEvent", () => {
    it("creates log event with timestamp", () => {
        const line = "2026-03-12T11:07:15.811624160Z Server running on port 5230";
        const event = createLogEvent("memos", line);

        expect(event).toEqual({
            type: "log",
            service: "memos",
            line: "Server running on port 5230",
            timestamp: "2026-03-12T11:07:15.811624160Z",
        });
    });

    it("creates log event without timestamp", () => {
        const line = "Server running on port 5230";
        const event = createLogEvent("memos", line);

        expect(event).toEqual({
            type: "log",
            service: "memos",
            line: "Server running on port 5230",
        });
    });

    it("handles different service names", () => {
        const event = createLogEvent("nginx", "test log");

        expect(event.service).toBe("nginx");
    });
});

describe("processDockerLogChunk", () => {
    it("processes single multiplexed log line", () => {
        // Docker multiplex format: [stream_type(1)][padding(3)][size(4)][content]
        const content = "2026-03-12T11:07:15.811624160Z Server running on port 5230";
        const size = Buffer.byteLength(content);

        const buffer = Buffer.alloc(8 + size);
        buffer[0] = 0x01; // stdout
        buffer.writeUInt32BE(size, 4);
        buffer.write(content, 8);

        const events: LogLineEvent[] = [];
        processDockerLogChunk(buffer, "memos", (event) => events.push(event));

        expect(events).toHaveLength(1);
        expect(events[0]).toEqual({
            type: "log",
            service: "memos",
            line: "Server running on port 5230",
            timestamp: "2026-03-12T11:07:15.811624160Z",
        });
    });

    it("processes multiple multiplexed log lines", () => {
        const line1 = "2026-03-12T11:07:15.811624160Z First line";
        const line2 = "2026-03-12T11:07:16.811624160Z Second line";

        const size1 = Buffer.byteLength(line1);
        const size2 = Buffer.byteLength(line2);

        const buffer = Buffer.alloc(8 + size1 + 8 + size2);

        // First log line
        buffer[0] = 0x01;
        buffer.writeUInt32BE(size1, 4);
        buffer.write(line1, 8);

        // Second log line
        buffer[8 + size1] = 0x01;
        buffer.writeUInt32BE(size2, 8 + size1 + 4);
        buffer.write(line2, 8 + size1 + 8);

        const events: LogLineEvent[] = [];
        processDockerLogChunk(buffer, "test", (event) => events.push(event));

        expect(events).toHaveLength(2);
        expect(events[0].line).toBe("First line");
        expect(events[1].line).toBe("Second line");
    });

    it("processes stderr stream (0x02)", () => {
        const content = "Error message";
        const size = Buffer.byteLength(content);

        const buffer = Buffer.alloc(8 + size);
        buffer[0] = 0x02; // stderr
        buffer.writeUInt32BE(size, 4);
        buffer.write(content, 8);

        const events: LogLineEvent[] = [];
        processDockerLogChunk(buffer, "test", (event) => events.push(event));

        expect(events).toHaveLength(1);
        expect(events[0].line).toBe("Error message");
    });

    it("handles non-multiplexed plain text", () => {
        const content = "Plain text log\nAnother line";
        const buffer = Buffer.from(content);

        const events: LogLineEvent[] = [];
        processDockerLogChunk(buffer, "test", (event) => events.push(event));

        expect(events).toHaveLength(2);
        expect(events[0].line).toBe("Plain text log");
        expect(events[1].line).toBe("Another line");
    });

    it("skips empty lines", () => {
        const content = "Line 1\n\nLine 2";
        const buffer = Buffer.from(content);

        const events: LogLineEvent[] = [];
        processDockerLogChunk(buffer, "test", (event) => events.push(event));

        expect(events).toHaveLength(2);
        expect(events[0].line).toBe("Line 1");
        expect(events[1].line).toBe("Line 2");
    });

    it("handles incomplete multiplex header", () => {
        // Buffer with only 7 bytes (needs 8 for header)
        const buffer = Buffer.alloc(7);
        buffer[0] = 0x01;

        const events: LogLineEvent[] = [];
        processDockerLogChunk(buffer, "test", (event) => events.push(event));

        expect(events).toHaveLength(0);
    });

    it("handles truncated content", () => {
        // Header says 100 bytes but buffer only has 20
        const buffer = Buffer.alloc(20);
        buffer[0] = 0x01;
        buffer.writeUInt32BE(100, 4);
        buffer.write("short", 8);

        const events: LogLineEvent[] = [];
        processDockerLogChunk(buffer, "test", (event) => events.push(event));

        expect(events).toHaveLength(0);
    });

    it("trims whitespace from log lines", () => {
        const content = "  Line with spaces  ";
        const size = Buffer.byteLength(content);

        const buffer = Buffer.alloc(8 + size);
        buffer[0] = 0x01;
        buffer.writeUInt32BE(size, 4);
        buffer.write(content, 8);

        const events: LogLineEvent[] = [];
        processDockerLogChunk(buffer, "test", (event) => events.push(event));

        expect(events).toHaveLength(1);
        expect(events[0].line).toBe("Line with spaces");
    });

    it("handles real-world Docker log format", () => {
        // Simulate actual Docker multiplexed output with multiple lines in one chunk
        const lines = [
            "Memos 0.26.1 started successfully!",
            "Data directory: /var/opt/memos",
            "Database driver: sqlite",
        ];

        let offset = 0;
        const buffers: Buffer[] = [];

        for (const line of lines) {
            const content = `2026-03-12T11:07:15.811624160Z ${line}`;
            const size = Buffer.byteLength(content);
            const buf = Buffer.alloc(8 + size);
            buf[0] = 0x01;
            buf.writeUInt32BE(size, 4);
            buf.write(content, 8);
            buffers.push(buf);
        }

        const buffer = Buffer.concat(buffers);

        const events: LogLineEvent[] = [];
        processDockerLogChunk(buffer, "memos", (event) => events.push(event));

        expect(events).toHaveLength(3);
        expect(events[0].line).toBe("Memos 0.26.1 started successfully!");
        expect(events[1].line).toBe("Data directory: /var/opt/memos");
        expect(events[2].line).toBe("Database driver: sqlite");
        expect(events[0].timestamp).toBe("2026-03-12T11:07:15.811624160Z");
    });
});
