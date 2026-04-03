CREATE TABLE auth_user (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE auth_session (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    device_name TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX auth_session_user_id_idx
    ON auth_session (user_id, created_at DESC);

CREATE TABLE auth_refresh_token (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES auth_session(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
    family_id UUID NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX auth_refresh_token_family_idx
    ON auth_refresh_token (family_id);

CREATE INDEX auth_refresh_token_session_idx
    ON auth_refresh_token (session_id, created_at DESC);

CREATE TABLE auth_event (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES auth_user(id) ON DELETE SET NULL,
    session_id UUID REFERENCES auth_session(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    ip_address TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX auth_event_user_created_at_idx
    ON auth_event (user_id, created_at DESC);
