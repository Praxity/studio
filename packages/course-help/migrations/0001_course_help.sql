-- One row per message. A question has thread_id NULL; replies point at their question.
-- Every row repeats the learner, so each learner read and write is scoped by learner_id alone.
CREATE TABLE help_messages (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	learner_id TEXT NOT NULL CHECK (length(learner_id) BETWEEN 1 AND 200),
	learner_email TEXT NOT NULL CHECK (length(learner_email) BETWEEN 1 AND 320),
	thread_id INTEGER REFERENCES help_messages(id),
	page_id TEXT CHECK (page_id IS NULL OR length(page_id) BETWEEN 1 AND 200),
	page_title TEXT CHECK (page_title IS NULL OR length(page_title) <= 200),
	quote TEXT CHECK (quote IS NULL OR length(quote) <= 300),
	body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
	from_staff INTEGER NOT NULL DEFAULT 0 CHECK (from_staff IN (0, 1)),
	-- When the learner first saw a staff reply.
	read_at TEXT,
	created_at TEXT NOT NULL,
	CHECK ((thread_id IS NULL) = (page_id IS NOT NULL))
);
CREATE INDEX help_messages_learner ON help_messages (learner_id, id);
CREATE INDEX help_messages_thread ON help_messages (thread_id, id);
