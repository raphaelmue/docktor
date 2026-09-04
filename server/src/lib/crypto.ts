import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const TAG_LENGTH = 16

function getKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY
    if (!key) throw new Error("ENCRYPTION_KEY env var is required")
    const buf = Buffer.from(key, "hex")
    if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes (64 hex chars)")
    return buf
}

export function encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, getKey(), iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
    const tag = cipher.getAuthTag()
    // Format: iv(12 bytes) + tag(16 bytes) + ciphertext — all hex-encoded
    return Buffer.concat([iv, tag, encrypted]).toString("hex")
}

export function decrypt(ciphertext: string): string {
    const buf = Buffer.from(ciphertext, "hex")
    const iv = buf.subarray(0, IV_LENGTH)
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
    const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH)
    const decipher = createDecipheriv(ALGORITHM, getKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")
}
