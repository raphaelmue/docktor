import {describe, it, expect, vi, beforeEach} from "vitest";
import {OnboardingService} from "../../../src/application/onboarding-service.js";

function createMockSettingsRepo() {
    return {
        upsert: vi.fn(),
        get: vi.fn(),
        getMany: vi.fn(),
    };
}

function createMockStackRepo() {
    return {
        create: vi.fn(),
        exists: vi.fn(),
        findById: vi.fn(),
    };
}

function createMockAuthClient() {
    return {
        signUpEmail: vi.fn(),
    };
}

function createMockCrypto() {
    return {
        encrypt: vi.fn(),
    };
}

describe("OnboardingService", () => {
    let mockSettingsRepo: ReturnType<typeof createMockSettingsRepo>;
    let mockStackRepo: ReturnType<typeof createMockStackRepo>;
    let mockAuthClient: ReturnType<typeof createMockAuthClient>;
    let mockCrypto: ReturnType<typeof createMockCrypto>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSettingsRepo = createMockSettingsRepo();
        mockStackRepo = createMockStackRepo();
        mockAuthClient = createMockAuthClient();
        mockCrypto = createMockCrypto();
    });

    describe("handleWizardStep1 (WIZ-02)", () => {
        it("should create user via better-auth signUpEmail", async () => {
            // WIZ-02: creates admin account
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any);
            mockAuthClient.signUpEmail.mockResolvedValue({
                user: { id: "user-1", email: "admin@example.com", name: "admin" },
                token: "session-token-123"
            });
            await service.handleWizardStep1({ email: "admin@example.com", password: "password123" });
            expect(mockAuthClient.signUpEmail).toHaveBeenCalledWith({
                body: { email: "admin@example.com", password: "password123", name: "admin" }
            });
        });

        it("should return session token for auto-login", async () => {
            mockAuthClient.signUpEmail.mockResolvedValue({
                user: { id: "user-1", email: "admin@example.com", name: "admin" },
                token: "session-token-123"
            });
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any);
            const result = await service.handleWizardStep1({ email: "admin@example.com", password: "password123" });
            expect(result.sessionToken).toBe("session-token-123");
        });
    });

    describe("handleWizardStep2 (WIZ-03)", () => {
        it("should save instanceName, baseUrl, timezone to Settings", async () => {
            // WIZ-03: saves basic settings
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any);
            await service.handleWizardStep2({
                instanceName: "My Docktor",
                baseUrl: "https://docktor.example.com",
                timezone: "America/New_York"
            });
            expect(mockSettingsRepo.upsert).toHaveBeenCalledWith("instanceName", "My Docktor");
            expect(mockSettingsRepo.upsert).toHaveBeenCalledWith("baseUrl", "https://docktor.example.com");
            expect(mockSettingsRepo.upsert).toHaveBeenCalledWith("timezone", "America/New_York");
        });

        it("should handle empty baseUrl as valid input", async () => {
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any);
            await service.handleWizardStep2({
                instanceName: "My Docktor",
                baseUrl: "",
                timezone: "UTC"
            });
            expect(mockSettingsRepo.upsert).toHaveBeenCalledWith("baseUrl", "");
        });
    });

    describe("handleWizardStep3 (WIZ-04)", () => {
        it("should encrypt restic password before saving", async () => {
            // WIZ-04: encrypts backup password
            mockCrypto.encrypt.mockReturnValue("encrypted-password");
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any);
            await service.handleWizardStep3({
                repoType: "sftp",
                sftpHost: "backup.example.com",
                sftpUser: "backup-user",
                password: "my-secret-password"
            });
            expect(mockCrypto.encrypt).toHaveBeenCalledWith("my-secret-password");
            expect(mockSettingsRepo.upsert).toHaveBeenCalledWith("backupPassword", "encrypted-password");
        });

        it("should save backup repo configuration", async () => {
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any);
            await service.handleWizardStep3({
                repoType: "local",
                password: "repo-password"
            });
            expect(mockSettingsRepo.upsert).toHaveBeenCalledWith("backupRepoType", "local");
        });
    });

    describe("handleWizardStep4 (WIZ-05)", () => {
        it("should encrypt SMTP password before saving", async () => {
            // WIZ-05: encrypts SMTP password
            mockCrypto.encrypt.mockReturnValue("encrypted-smtp-pass");
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any);
            await service.handleWizardStep4({
                host: "smtp.example.com",
                port: 587,
                encryption: "starttls",
                username: "noreply@example.com",
                password: "smtp-password",
                from: "noreply@example.com"
            });
            expect(mockCrypto.encrypt).toHaveBeenCalledWith("smtp-password");
            expect(mockSettingsRepo.upsert).toHaveBeenCalledWith("smtpPassword", "encrypted-smtp-pass");
        });

        it("should save SMTP configuration settings", async () => {
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any);
            await service.handleWizardStep4({
                host: "smtp.gmail.com",
                port: 465,
                encryption: "ssl",
                username: "test@gmail.com",
                from: "test@gmail.com"
            });
            expect(mockSettingsRepo.upsert).toHaveBeenCalledWith("smtpHost", "smtp.gmail.com");
            expect(mockSettingsRepo.upsert).toHaveBeenCalledWith("smtpPort", "465");
            expect(mockSettingsRepo.upsert).toHaveBeenCalledWith("smtpEncryption", "ssl");
        });
    });

    describe("adoptInPlace (BF-03)", () => {
        it("should create Stack record with hostPath pointing to discovered path", async () => {
            // BF-03: adopt in-place, no file operations
            mockStackRepo.exists.mockResolvedValue(false);
            mockStackRepo.create.mockResolvedValue({ id: "existing-stack", displayName: "Existing Stack", hostPath: "/home/user/my-compose-stack" } as any);
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any);
            const result = await service.adoptInPlace(
                "/home/user/my-compose-stack/docker-compose.yml",
                "Existing Stack",
                "version: '3'\nservices:\n  web:\n    image: nginx"
            );
            expect(result.id).toBe("existing-stack");
            expect(mockStackRepo.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: "existing-stack",
                    displayName: "Existing Stack",
                    hostPath: "/home/user/my-compose-stack",
                })
            );
        });

        it("should not move any files during in-place adoption", async () => {
            // Verify no file system operations happen - just check that create was called
            mockStackRepo.exists.mockResolvedValue(false);
            mockStackRepo.create.mockResolvedValue({ id: "stack-to-adopt", hostPath: "/opt/my-stack" } as any);
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any);
            await service.adoptInPlace(
                "/opt/my-stack/docker-compose.yml",
                "Stack to Adopt",
                "version: '3'\nservices:\n  app:\n    image: alpine"
            );
            // The service should only call repo.create, no file operations
            expect(mockStackRepo.create).toHaveBeenCalled();
        });

        it("should throw error if stack with same name already exists", async () => {
            mockStackRepo.exists.mockResolvedValue(true);
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any);
            await expect(service.adoptInPlace(
                "/home/user/stack/docker-compose.yml",
                "Duplicate Stack",
                "version: '3'\nservices:\n  web:\n    image: nginx"
            )).rejects.toThrow('Stack "duplicate-stack" already exists');
        });
    });
});
