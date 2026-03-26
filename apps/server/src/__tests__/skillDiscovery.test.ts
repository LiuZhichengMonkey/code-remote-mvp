import fs from 'fs';
import os from 'os';
import path from 'path';
import { listAvailableSkills } from '../skillDiscovery';

function writeSkill(
  rootPath: string,
  relativeDirectory: string,
  metadata: {
    name: string;
    description: string;
  }
) {
  const skillDirectory = path.join(rootPath, relativeDirectory);
  fs.mkdirSync(skillDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(skillDirectory, 'SKILL.md'),
    `---\nname: "${metadata.name}"\ndescription: "${metadata.description}"\n---\n`,
    'utf-8'
  );
}

describe('skillDiscovery', () => {
  let tempRoot: string;
  let workspaceRoot: string;
  let homeRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coderemote-skills-'));
    workspaceRoot = path.join(tempRoot, 'workspace');
    homeRoot = path.join(tempRoot, 'home');
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.mkdirSync(homeRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('lists codex skills from project, user, generic, and nested system roots with project priority', () => {
    writeSkill(workspaceRoot, path.join('.codex', 'skills', 'gsd-debug'), {
      name: 'Project Debug',
      description: 'Project skill wins over user duplicate'
    });
    writeSkill(workspaceRoot, path.join('.agents', 'skills', 'brainstorming'), {
      name: 'Project Brainstorm',
      description: 'Generic project skill'
    });
    writeSkill(homeRoot, path.join('.codex', 'skills', 'gsd-debug'), {
      name: 'User Debug',
      description: 'Should be shadowed'
    });
    writeSkill(homeRoot, path.join('.codex', 'skills', '.system', 'openai-docs'), {
      name: 'OpenAI Docs',
      description: 'System skill'
    });
    writeSkill(homeRoot, path.join('.agents', 'skills', 'create-readme'), {
      name: 'Create README',
      description: 'Generic user skill'
    });

    const skills = listAvailableSkills(workspaceRoot, 'codex', { homeDir: homeRoot });
    const byCommand = new Map(skills.map(skill => [skill.command, skill]));

    expect(byCommand.get('gsd-debug')).toEqual(expect.objectContaining({
      name: 'Project Debug',
      description: 'Project skill wins over user duplicate',
      source: 'project'
    }));
    expect(byCommand.get('brainstorming')).toEqual(expect.objectContaining({
      source: 'project'
    }));
    expect(byCommand.get('create-readme')).toEqual(expect.objectContaining({
      source: 'user'
    }));
    expect(byCommand.get('openai-docs')).toEqual(expect.objectContaining({
      source: 'system'
    }));
  });

  test('lists claude skills from claude roots and generic roots', () => {
    writeSkill(homeRoot, path.join('.claude', 'skills', 'claude-helper'), {
      name: 'Claude Helper',
      description: 'Claude specific skill'
    });
    writeSkill(homeRoot, path.join('.agents', 'skills', 'shared-skill'), {
      name: 'Shared Skill',
      description: 'Generic helper'
    });

    const skills = listAvailableSkills(workspaceRoot, 'claude', { homeDir: homeRoot });
    const commands = skills.map(skill => skill.command);

    expect(commands).toContain('claude-helper');
    expect(commands).toContain('shared-skill');
  });
});
