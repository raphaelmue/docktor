import {describe, it, expect, vi, beforeEach} from "vitest";
import {OnboardingService} from "../../../src/application/onboarding-service.js";
import {ConflictError, BadRequestError} from "../../../src/lib/errors.js";

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

function createMockFsLib() {
    return {
        readFile: vi.fn(),
    };
}

function createMockProxy() {
    return {
        updateProxySettingsAndSync: vi.fn(),
        deployProxyStack: vi.fn(),
    };
}

describe("OnboardingService", () => {
    let mockSettingsRepo: ReturnType<typeof createMockSettingsRepo>;
    let mockStackRepo: ReturnType<typeof createMockStackRepo>;
    let mockAuthClient: ReturnType<typeof createMockAuthClient>;
    let mockCrypto: ReturnType<typeof createMockCrypto>;
    let mockFsLib: ReturnType<typeof createMockFsLib>;
    let mockProxy: ReturnType<typeof createMockProxy>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSettingsRepo = createMockSettingsRepo();
        mockStackRepo = createMockStackRepo();
        mockAuthClient = createMockAuthClient();
        mockCrypto = createMockCrypto();
        mockFsLib = createMockFsLib();
        mockProxy = createMockProxy();
    });

    describe("handleWizardStep1 (WIZ-02)", () => {
        it("should create user via better-auth signUpEmail", async () => {
            // WIZ-02: creates admin account
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any, mockProxy as any);
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
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any, mockProxy as any);
            const result = await service.handleWizardStep1({ email: "admin@example.com", password: "password123" });
            expect(result.sessionToken).toBe("session-token-123");
        });
    });

    describe("handleWizardStep2 (WIZ-03)", () => {
        it("should save instanceName, baseUrl, timezone to Settings", async () => {
            // WIZ-03: saves basic settings
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any, mockProxy as any);
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
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any, mockProxy as any);
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
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any, mockProxy as any);
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
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any, mockProxy as any);
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
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any, mockProxy as any);
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
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any, mockProxy as any);
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
            // BF-03: adopt in-place — no stack-directory move/copy; the compose
            // file itself is read (WR-05) to build the stored compose config.
            mockStackRepo.exists.mockResolvedValue(false);
            mockStackRepo.create.mockResolvedValue({ id: "existing-stack", displayName: "Existing Stack", hostPath: "/home/user/my-compose-stack" } as any);
            mockFsLib.readFile.mockResolvedValue("version: '3'\nservices:\n  web:\n    image: nginx");
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any, mockProxy as any, mockFsLib as any);
            const result = await service.adoptInPlace(
                "/home/user/my-compose-stack/docker-compose.yml",
                "Existing Stack",
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

        it("should read the compose file at composePath but not move/copy the stack directory", async () => {
            // WR-05: the service now performs the file read (previously done in
            // the route handler) — verify it reads exactly the given path and
            // otherwise only calls repo.create (no directory copy/move calls).
            mockStackRepo.exists.mockResolvedValue(false);
            mockStackRepo.create.mockResolvedValue({ id: "stack-to-adopt", hostPath: "/opt/my-stack" } as any);
            mockFsLib.readFile.mockResolvedValue("version: '3'\nservices:\n  app:\n    image: alpine");
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any, mockProxy as any, mockFsLib as any);
            await service.adoptInPlace(
                "/opt/my-stack/docker-compose.yml",
                "Stack to Adopt",
            );
            expect(mockFsLib.readFile).toHaveBeenCalledWith("/opt/my-stack/docker-compose.yml", "utf-8");
            expect(mockStackRepo.create).toHaveBeenCalled();
        });

        it("should strip a bare compose.yml filename (no docker- prefix) from hostPath (WR-10)", async () => {
            mockStackRepo.exists.mockResolvedValue(false);
            mockStackRepo.create.mockResolvedValue({ id: "bare-compose", hostPath: "/opt/bare-stack" } as any);
            mockFsLib.readFile.mockResolvedValue("services:\n  app:\n    image: alpine");
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any, mockProxy as any, mockFsLib as any);
            await service.adoptInPlace(
                "/opt/bare-stack/compose.yml",
                "Bare Compose",
            );
            expect(mockStackRepo.create).toHaveBeenCalledWith(
                expect.objectContaining({hostPath: "/opt/bare-stack"})
            );
        });

        it("should throw error if stack with same name already exists, without reading the compose file", async () => {
            mockStackRepo.exists.mockResolvedValue(true);
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any, mockProxy as any, mockFsLib as any);
            await expect(service.adoptInPlace(
                "/home/user/stack/docker-compose.yml",
                "Duplicate Stack",
            )).rejects.toThrow('Stack "duplicate-stack" already exists');
            expect(mockFsLib.readFile).not.toHaveBeenCalled();
        });
    });

    describe("handleWizardStep6 (PRXY-02/PRXY-03)", () => {
        it("should save the acmeEmail setting before deploying the proxy stack", async () => {
            const callOrder: string[] = [];
            mockProxy.updateProxySettingsAndSync.mockImplementation(async () => {
                callOrder.push("save");
            });
            mockProxy.deployProxyStack.mockImplementation(async () => {
                callOrder.push("deploy");
            });
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any, mockProxy as any);

            await service.handleWizardStep6({acmeEmail: "admin@example.com"});

            expect(mockProxy.updateProxySettingsAndSync).toHaveBeenCalledWith({acmeEmail: "admin@example.com"});
            expect(callOrder).toEqual(["save", "deploy"]);
        });

        it("should still deploy the proxy stack when acmeEmail is an empty string (D-09)", async () => {
            mockProxy.updateProxySettingsAndSync.mockResolvedValue(undefined);
            mockProxy.deployProxyStack.mockResolvedValue(undefined);
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any, mockProxy as any);

            await service.handleWizardStep6({acmeEmail: ""});

            expect(mockProxy.updateProxySettingsAndSync).toHaveBeenCalledWith({acmeEmail: ""});
            expect(mockProxy.deployProxyStack).toHaveBeenCalledTimes(1);
        });

        it("should propagate a ConflictError from deployProxyStack unwrapped and with its message intact", async () => {
            mockProxy.updateProxySettingsAndSync.mockResolvedValue(undefined);
            mockProxy.deployProxyStack.mockRejectedValue(
                new ConflictError('Host port 80 is already published by container "web-1". Free the port and try again.'),
            );
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any, mockProxy as any);

            await expect(service.handleWizardStep6({acmeEmail: ""})).rejects.toThrow(ConflictError);
            await expect(service.handleWizardStep6({acmeEmail: ""})).rejects.toThrow(
                'Host port 80 is already published by container "web-1". Free the port and try again.',
            );
        });

        it("should propagate a BadRequestError carrying raw compose stderr from deployProxyStack unwrapped", async () => {
            mockProxy.updateProxySettingsAndSync.mockResolvedValue(undefined);
            mockProxy.deployProxyStack.mockRejectedValue(
                new BadRequestError("Failed to deploy the proxy stack: exit code 1: network docktor_proxy not found"),
            );
            const service = new OnboardingService(mockAuthClient as any, mockSettingsRepo as any, mockCrypto as any, mockStackRepo as any, mockProxy as any);

            await expect(service.handleWizardStep6({acmeEmail: ""})).rejects.toThrow(BadRequestError);
            await expect(service.handleWizardStep6({acmeEmail: ""})).rejects.toThrow(
                "Failed to deploy the proxy stack: exit code 1: network docktor_proxy not found",
            );
        });
    });
});
