-- Version history and comments.
-- Both live OUTSIDE the Yjs document on purpose: a version is a frozen copy of the whole
-- document, and comments are conversation about the document, not part of its text.

CREATE TYPE version_kind AS ENUM ('manual', 'auto');

CREATE TABLE document_versions (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid         NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  -- NULL for automatic checkpoints (nobody "saved" them) and for authors whose account was removed.
  created_by  uuid         REFERENCES users (id) ON DELETE SET NULL,
  kind        version_kind NOT NULL,
  label       text         CHECK (label IS NULL OR length(label) <= 120),
  -- The full merged Yjs state at that moment (one encoded update).
  state       bytea        NOT NULL,
  size_bytes  integer      NOT NULL CHECK (size_bytes >= 0),
  created_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX document_versions_document_idx ON document_versions (document_id, created_at DESC);

CREATE TABLE comments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  author_id   uuid        REFERENCES users (id) ON DELETE SET NULL,
  body        text        NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  -- A COPY of the text the comment was about. It is a quote, not a live anchor: if the text is
  -- edited or deleted, the quote stays as written.
  quote       text        CHECK (quote IS NULL OR length(quote) <= 300),
  resolved    boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_document_idx ON comments (document_id, created_at);
