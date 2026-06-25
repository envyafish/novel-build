export const MIGRATIONS: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        current_volume_id INTEGER
      );
      CREATE TABLE volumes (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        UNIQUE(project_id, slug)
      );
      CREATE TABLE chapters (
        id INTEGER PRIMARY KEY,
        volume_id INTEGER NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        UNIQUE(volume_id, slug)
      );
      CREATE TABLE scenes (
        id INTEGER PRIMARY KEY,
        chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        target_words INTEGER,
        notes TEXT,
        content_hash TEXT NOT NULL,
        entity_refs TEXT NOT NULL DEFAULT '[]',
        UNIQUE(chapter_id, slug)
      );
      CREATE TABLE ai_settings (
        project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL,
        system_prompt TEXT NOT NULL DEFAULT '',
        context_prev_chars INTEGER NOT NULL DEFAULT 1500
      );
      CREATE TABLE snapshots_meta (
        hash TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        parent_hash TEXT
      );
    `,
  },
  {
    id: 2,
    sql: `
      CREATE TABLE characters (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        aliases TEXT NOT NULL DEFAULT '[]',
        appearance TEXT NOT NULL DEFAULT '',
        personality TEXT NOT NULL DEFAULT '',
        background TEXT NOT NULL DEFAULT '',
        relationships TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE world_elements (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'concept',
        description TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE timeline_events (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        era TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        related_character_ids TEXT NOT NULL DEFAULT '[]',
        related_world_ids TEXT NOT NULL DEFAULT '[]',
        notes TEXT NOT NULL DEFAULT '',
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE foreshadows (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'planted',
        planted_scene_id INTEGER REFERENCES scenes(id) ON DELETE SET NULL,
        resolved_scene_id INTEGER REFERENCES scenes(id) ON DELETE SET NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: 3,
    sql: `
      ALTER TABLE projects ADD COLUMN theme TEXT NOT NULL DEFAULT '';

      CREATE TABLE conflicts (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'person_vs_person',
        description TEXT NOT NULL DEFAULT '',
        related_character_ids TEXT NOT NULL DEFAULT '[]',
        setup TEXT NOT NULL DEFAULT '',
        escalation TEXT NOT NULL DEFAULT '',
        climax TEXT NOT NULL DEFAULT '',
        resolution TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'setup',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: 4,
    sql: `
      CREATE TABLE writing_goals (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
        daily_target_words INTEGER NOT NULL DEFAULT 2000,
        weekly_target_scenes INTEGER NOT NULL DEFAULT 5,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: 5,
    sql: `ALTER TABLE projects ADD COLUMN story_arc_notes TEXT NOT NULL DEFAULT '';`,
  },
  {
    id: 6,
    sql: `
      CREATE TABLE ai_drafts (
        id TEXT PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        scene_id INTEGER REFERENCES scenes(id) ON DELETE CASCADE,
        mode TEXT NOT NULL,
        model TEXT NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'streaming',
        error_message TEXT,
        max_output_tokens INTEGER NOT NULL DEFAULT 0,
        usage_prompt_tokens INTEGER NOT NULL DEFAULT 0,
        usage_completion_tokens INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX idx_ai_drafts_scene ON ai_drafts(scene_id);
      CREATE INDEX idx_ai_drafts_expires ON ai_drafts(expires_at);
    `,
  },
  {
    id: 7,
    sql: `
      CREATE TABLE daily_word_log (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        words_added INTEGER NOT NULL DEFAULT 0,
        UNIQUE(project_id, date)
      );
      CREATE INDEX idx_daily_word_log_project_date ON daily_word_log(project_id, date);
    `,
  },
  {
    id: 8,
    sql: `ALTER TABLE characters ADD COLUMN voice_profile TEXT NOT NULL DEFAULT '';`,
  },
]
