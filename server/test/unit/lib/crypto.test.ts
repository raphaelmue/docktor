import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { decrypt, encrypt } from "../../../src/lib/crypto.js"

const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

describe("crypto", () => {
    beforeEach(() => {
        process.env.ENCRYPTION_KEY = TEST_KEY
    })

    afterEach(() => {
        delete process.env.ENCRYPTION_KEY
    })

    it("encrypts and decrypts a round-trip correctly", () => {
        const plaintext = "hello"
        const ciphertext = encrypt(plaintext)
        expect(decrypt(ciphertext)).toBe(plaintext)
    })

    it("produces different ciphertext on each call (random IV)", () => {
        const plaintext = "hello"
        const first = encrypt(plaintext)
        const second = encrypt(plaintext)
        expect(first).not.toBe(second)
    })

    it("throws on tampered ciphertext", () => {
        const ciphertext = encrypt("hello")
        // Flip a byte in the middle of the ciphertext (past IV+tag)
        const buf = Buffer.from(ciphertext, "hex")
        buf[buf.length - 1] ^= 0xff
        const tampered = buf.toString("hex")
        expect(() => decrypt(tampered)).toThrow()
    })

    it("throws when ENCRYPTION_KEY env var is missing", () => {
        delete process.env.ENCRYPTION_KEY
        expect(() => encrypt("hello")).toThrow("ENCRYPTION_KEY env var is required")
    })

    it("throws when ENCRYPTION_KEY is not 32 bytes (64 hex chars)", () => {
        process.env.ENCRYPTION_KEY = "deadbeef"
        expect(() => encrypt("hello")).toThrow("ENCRYPTION_KEY must be 32 bytes (64 hex chars)")
    })
})
