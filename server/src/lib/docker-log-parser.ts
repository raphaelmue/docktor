export interface LogLineEvent {
    type: "log"
    service: string
    line: string
    timestamp?: string
}

export function parseTimestamp(line: string): { timestamp?: string; content: string } {
    const match = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) (.*)$/)
    return match ? { timestamp: match[1], content: match[2] } : { content: line }
}

export function createLogEvent(serviceName: string, line: string): LogLineEvent {
    const { timestamp, content } = parseTimestamp(line)
    return {
        type: "log",
        service: serviceName,
        line: content,
        ...(timestamp && { timestamp }),
    }
}

export function processDockerLogChunk(
    chunk: Buffer,
    serviceName: string,
    onEvent: (event: LogLineEvent) => void
): void {
    let offset = 0

    while (offset < chunk.length) {
        const streamType = chunk[offset]
        const isMultiplexed = streamType === 0x01 || streamType === 0x02

        if (!isMultiplexed) {
            const text = chunk.slice(offset).toString("utf8").trim()
            if (text) {
                text.split("\n").forEach(line => {
                    if (line) onEvent(createLogEvent(serviceName, line))
                })
            }
            break
        }

        if (offset + 8 > chunk.length) break

        const size = chunk.readUInt32BE(offset + 4)
        const start = offset + 8
        const end = start + size

        if (end > chunk.length) break

        const line = chunk.slice(start, end).toString("utf8").trim()
        if (line) onEvent(createLogEvent(serviceName, line))

        offset = end
    }
}
