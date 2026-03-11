import {describe, expect, it, vi, beforeEach} from "vitest";
import {SettingsService} from "../../../../src/application/settings-service.js";

function createMockSettingsRepository() {
    return {
        findByKey: vi.fn(),
        upsert: vi.fn(),
        findAll: vi.fn(),
    };
}

describe("SettingsService", () => {
    let service: SettingsService;
    let mockRepo: ReturnType<typeof createMockSettingsRepository>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRepo = createMockSettingsRepository();
        service = new SettingsService(mockRepo as any);
    });

    describe("getSetting (SET-01)", () => {
        it("returns null when key not found in repository", async () => {
            mockRepo.findByKey.mockResolvedValue(null);

            const result = await service.getSetting("non-existent-key");

            expect(mockRepo.findByKey).toHaveBeenCalledWith("non-existent-key");
            expect(result).toBeNull();
        });

        it("returns the value string when key is found", async () => {
            mockRepo.findByKey.mockResolvedValue({key: "instanceName", value: "Docktor"});

            const result = await service.getSetting("instanceName");

            expect(result).toBe("Docktor");
        });
    });

    describe("upsertSetting (SET-02)", () => {
        it("calls repository.upsert with key and value", async () => {
            mockRepo.upsert.mockResolvedValue(undefined);

            await service.upsertSetting("instanceName", "My Docktor");

            expect(mockRepo.upsert).toHaveBeenCalledWith("instanceName", "My Docktor");
        });
    });

    describe("updateGeneralSettings (SET-01, SET-02)", () => {
        it("validates and saves instanceName, baseUrl, timezone", async () => {
            mockRepo.upsert.mockResolvedValue(undefined);

            await service.updateGeneralSettings({
                instanceName: "My Server",
                baseUrl: "https://docktor.example.com",
                timezone: "America/New_York",
            });

            expect(mockRepo.upsert).toHaveBeenCalledWith("instanceName", "My Server");
            expect(mockRepo.upsert).toHaveBeenCalledWith("baseUrl", "https://docktor.example.com");
            expect(mockRepo.upsert).toHaveBeenCalledWith("timezone", "America/New_York");
        });

        it("throws on invalid input — empty instanceName", async () => {
            await expect(
                service.updateGeneralSettings({
                    instanceName: "",
                    baseUrl: "https://docktor.example.com",
                    timezone: "UTC",
                }),
            ).rejects.toThrow();

            expect(mockRepo.upsert).not.toHaveBeenCalled();
        });

        it("throws on invalid input — non-URL baseUrl", async () => {
            await expect(
                service.updateGeneralSettings({
                    instanceName: "My Server",
                    baseUrl: "notaurl",
                    timezone: "UTC",
                }),
            ).rejects.toThrow();

            expect(mockRepo.upsert).not.toHaveBeenCalled();
        });
    });
});
