import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFile = promisify(execFileCallback);
const tempDirs: string[] = [];

const mockProjectService = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  createWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
  updateWorkspace: vi.fn(),
  removeWorkspace: vi.fn(),
  remove: vi.fn(),
  resolveByReference: vi.fn(),
}));
const mockSecretService = vi.hoisted(() => ({
  normalizeEnvBindingsForPersistence: vi.fn(),
}));
const mockEnvironmentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));
const mockWorkspaceOperationService = vi.hoisted(() => ({}));
const mockLogActivity = vi.hoisted(() => vi.fn());
const mockGetTelemetryClient = vi.hoisted(() => vi.fn());
const mockAccessService = vi.hoisted(() => ({
  decide: vi.fn(),
}));

vi.mock("../telemetry.js", () => ({
  getTelemetryClient: mockGetTelemetryClient,
}));

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  environmentService: () => mockEnvironmentService,
  logActivity: mockLogActivity,
  projectService: () => mockProjectService,
  secretService: () => mockSecretService,
  workspaceOperationService: () => mockWorkspaceOperationService,
}));

vi.mock("../services/environments.js", () => ({
  environmentService: () => mockEnvironmentService,
}));

vi.mock("../services/secrets.js", () => ({
  secretService: () => mockSecretService,
}));

vi.mock("../services/workspace-runtime.js", () => ({
  startRuntimeServicesForWorkspaceControl: vi.fn(),
  stopRuntimeServicesForProjectWorkspace: vi.fn(),
}));

function registerModuleMocks() {
  vi.doMock("../telemetry.js", () => ({
    getTelemetryClient: mockGetTelemetryClient,
  }));

  vi.doMock("../services/index.js", () => ({
    accessService: () => mockAccessService,
    environmentService: () => mockEnvironmentService,
    logActivity: mockLogActivity,
    projectService: () => mockProjectService,
    secretService: () => mockSecretService,
    workspaceOperationService: () => mockWorkspaceOperationService,
  }));

  vi.doMock("../services/environments.js", () => ({
    environmentService: () => mockEnvironmentService,
  }));

  vi.doMock("../services/secrets.js", () => ({
    secretService: () => mockSecretService,
  }));

  vi.doMock("../services/workspace-runtime.js", () => ({
    startRuntimeServicesForWorkspaceControl: vi.fn(),
    stopRuntimeServicesForProjectWorkspace: vi.fn(),
  }));
}

async function createApp() {
  const [{ projectRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/projects.js")>("../routes/projects.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "board-user",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", projectRoutes({} as any));
  app.use(errorHandler);
  return app;
}

function buildProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    companyId: "company-1",
    urlKey: "project-1",
    goalId: null,
    goalIds: [],
    goals: [],
    name: "Project",
    description: null,
    status: "backlog",
    leadAgentId: null,
    targetDate: null,
    color: null,
    env: null,
    pauseReason: null,
    pausedAt: null,
    executionWorkspacePolicy: null,
    codebase: {
      workspaceId: null,
      repoUrl: null,
      repoRef: null,
      defaultRef: null,
      repoName: null,
      localFolder: null,
      managedFolder: "/tmp/project",
      effectiveLocalFolder: "/tmp/project",
      origin: "managed_checkout",
    },
    workspaces: [],
    primaryWorkspace: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("project env routes", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../routes/projects.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    vi.doUnmock("../services/environments.js");
    vi.doUnmock("../services/secrets.js");
    registerModuleMocks();
    vi.clearAllMocks();
    mockAccessService.decide.mockResolvedValue({
      allowed: true,
      action: "project:read",
      reason: "allow_test",
      explanation: "Allowed by test mock.",
    });
    mockGetTelemetryClient.mockReturnValue({ track: vi.fn() });
    mockProjectService.resolveByReference.mockResolvedValue({ ambiguous: false, project: null });
    mockProjectService.createWorkspace.mockResolvedValue(null);
    mockProjectService.listWorkspaces.mockResolvedValue([]);
    mockEnvironmentService.getById.mockReset();
    mockSecretService.normalizeEnvBindingsForPersistence.mockImplementation(async (_companyId, env) => env);
  });

  it("normalizes env bindings on create and logs only env keys", async () => {
    const normalizedEnv = {
      API_KEY: {
        type: "secret_ref",
        secretId: "11111111-1111-4111-8111-111111111111",
        version: "latest",
      },
    };
    mockSecretService.normalizeEnvBindingsForPersistence.mockResolvedValue(normalizedEnv);
    mockProjectService.create.mockResolvedValue(buildProject({ env: normalizedEnv }));

    const app = await createApp();
    const res = await request(app)
      .post("/api/companies/company-1/projects")
      .send({
        name: "Project",
        env: normalizedEnv,
      });

    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(mockSecretService.normalizeEnvBindingsForPersistence).toHaveBeenCalledWith(
      "company-1",
      normalizedEnv,
      expect.objectContaining({ fieldPath: "env" }),
    );
    expect(mockProjectService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({ env: normalizedEnv }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        details: expect.objectContaining({
          envKeys: ["API_KEY"],
        }),
      }),
    );
  });

  it("normalizes env bindings on update and avoids logging raw values", async () => {
    const normalizedEnv = {
      PLAIN_KEY: { type: "plain", value: "top-secret" },
    };
    mockSecretService.normalizeEnvBindingsForPersistence.mockResolvedValue(normalizedEnv);
    mockProjectService.getById.mockResolvedValue(buildProject());
    mockProjectService.update.mockResolvedValue(buildProject({ env: normalizedEnv }));

    const app = await createApp();
    const res = await request(app)
      .patch("/api/projects/project-1")
      .send({
        env: normalizedEnv,
      });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        details: {
          changedKeys: ["env"],
          envKeys: ["PLAIN_KEY"],
        },
      }),
    );
  });

  it("rejects local workspace creation when the directory has no git metadata", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-workspace-no-git-"));
    tempDirs.push(cwd);
    mockProjectService.getById.mockResolvedValue(buildProject());

    const app = await createApp();
    const res = await request(app)
      .post("/api/projects/project-1/workspaces")
      .send({ sourceType: "local_path", cwd });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toMatchObject({
      code: "workspace_cwd_missing_git_metadata",
      details: {
        code: "workspace_cwd_missing_git_metadata",
        cwd,
        sourceType: "local_path",
        fix: `git -C "${cwd}" init && git -C "${cwd}" commit --allow-empty -m "init"`,
        override: "Set allowMissingGit: true to bypass this check.",
      },
    });
    expect(mockProjectService.createWorkspace).not.toHaveBeenCalled();
  });

  it("rejects local workspace creation when the directory does not exist", async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-workspace-missing-"));
    tempDirs.push(parent);
    const cwd = path.join(parent, "not-created");
    mockProjectService.getById.mockResolvedValue(buildProject());

    const app = await createApp();
    const res = await request(app)
      .post("/api/projects/project-1/workspaces")
      .send({ sourceType: "local_path", cwd });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toMatchObject({
      code: "workspace_cwd_not_found",
      details: {
        code: "workspace_cwd_not_found",
        cwd,
        sourceType: "local_path",
        override: "Set allowMissingGit: true to bypass this check.",
      },
    });
  });

  it("creates local git workspaces and does not persist the validation override", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-workspace-git-"));
    tempDirs.push(cwd);
    await execFile("git", ["init", cwd]);
    const workspace = { id: "workspace-1", name: "Workspace", cwd, sourceType: "local_path", isPrimary: true };
    mockProjectService.getById.mockResolvedValue(buildProject());
    mockProjectService.createWorkspace.mockResolvedValue(workspace);

    const app = await createApp();
    const res = await request(app)
      .post("/api/projects/project-1/workspaces")
      .send({ sourceType: "local_path", cwd });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockProjectService.createWorkspace).toHaveBeenCalledWith(
      "project-1",
      expect.not.objectContaining({ allowMissingGit: expect.anything() }),
    );
  });

  it("allows missing git metadata when explicitly overridden", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-workspace-override-"));
    tempDirs.push(cwd);
    const workspace = { id: "workspace-1", name: "Workspace", cwd, sourceType: "local_path", isPrimary: true };
    mockProjectService.getById.mockResolvedValue(buildProject());
    mockProjectService.createWorkspace.mockResolvedValue(workspace);

    const app = await createApp();
    const res = await request(app)
      .post("/api/projects/project-1/workspaces")
      .send({ sourceType: "local_path", cwd, allowMissingGit: true });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockProjectService.createWorkspace).toHaveBeenCalledWith("project-1", { sourceType: "local_path", cwd });
  });

  it("does not apply local git validation to remote-managed workspaces", async () => {
    const workspace = {
      id: "workspace-1",
      name: "Remote",
      cwd: null,
      sourceType: "remote_managed",
      remoteWorkspaceRef: "remote-1",
      isPrimary: true,
    };
    mockProjectService.getById.mockResolvedValue(buildProject());
    mockProjectService.createWorkspace.mockResolvedValue(workspace);

    const app = await createApp();
    const res = await request(app)
      .post("/api/projects/project-1/workspaces")
      .send({ sourceType: "remote_managed", remoteWorkspaceRef: "remote-1" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it("validates the effective local workspace on update", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-workspace-patch-"));
    tempDirs.push(cwd);
    mockProjectService.getById.mockResolvedValue(buildProject());
    mockProjectService.listWorkspaces.mockResolvedValue([
      { id: "workspace-1", cwd, sourceType: "local_path" },
    ]);

    const app = await createApp();
    const res = await request(app)
      .patch("/api/projects/project-1/workspaces/workspace-1")
      .send({ name: "Renamed" });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code).toBe("workspace_cwd_missing_git_metadata");
    expect(mockProjectService.updateWorkspace).not.toHaveBeenCalled();
  });
});
