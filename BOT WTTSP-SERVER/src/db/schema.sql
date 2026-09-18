CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL,
    user_limit INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    plan_id UUID REFERENCES plans(id),
    user_limit INTEGER DEFAULT 5,
    whatsapp_limit INTEGER DEFAULT 10,
    max_profiles_per_operator INTEGER DEFAULT 3,
    status VARCHAR(20) DEFAULT 'active', -- active, suspended
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'user', -- superadmin, admin, user
    status VARCHAR(20) DEFAULT 'active', -- active, disabled
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS proxy_pool (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proxy_url VARCHAR(500) NOT NULL,
    label VARCHAR(100),
    max_capacity INTEGER DEFAULT 20,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(30) DEFAULT '',
    status VARCHAR(20) DEFAULT 'disconnected',
    is_active_bot BOOLEAN DEFAULT FALSE,
    message TEXT DEFAULT '',
    delay_min INTEGER DEFAULT 115,
    delay_max INTEGER DEFAULT 145,
    batch_size INTEGER DEFAULT 15,
    batch_pause_min INTEGER DEFAULT 25,
    batch_pause_max INTEGER DEFAULT 30,
    daily_limit INTEGER DEFAULT 200,
    sent_today INTEGER DEFAULT 0,
    last_sent_date DATE DEFAULT CURRENT_DATE,
    work_schedule_enabled BOOLEAN DEFAULT FALSE,
    work_schedule_start VARCHAR(10) DEFAULT '09:00',
    work_schedule_end VARCHAR(10) DEFAULT '18:00',
    work_schedule_days VARCHAR(50) DEFAULT '1,2,3,4,5',
    warmup_enabled BOOLEAN DEFAULT FALSE,
    warmup_day INTEGER DEFAULT 1,
    warmup_daily_increment INTEGER DEFAULT 15,
    warmup_max_limit INTEGER DEFAULT 200,
    is_paused_early_warning BOOLEAN DEFAULT FALSE,
    early_warning_reason TEXT DEFAULT '',
    proxy_id UUID REFERENCES proxy_pool(id) ON DELETE SET NULL,
    proxy_url VARCHAR(500) DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS phone_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    phone_number VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- pending, sent, error
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sent_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    phone_number VARCHAR(20) NOT NULL,
    result VARCHAR(20) DEFAULT 'sent',
    error_message TEXT DEFAULT '',
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    author_email VARCHAR(100) NOT NULL,
    company_name VARCHAR(100) NOT NULL,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    attachment_path TEXT DEFAULT NULL,
    attachment_name TEXT DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blacklist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    phone_number VARCHAR(30) NOT NULL,
    reason TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_company_phone UNIQUE (company_id, phone_number)
);

CREATE TABLE IF NOT EXISTS system_announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    priority VARCHAR(20) DEFAULT 'info', -- info, warning, danger
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    user_email VARCHAR(100) DEFAULT '',
    action VARCHAR(100) NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45) DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_blacklist_company_phone ON blacklist(company_id, phone_number);
CREATE INDEX IF NOT EXISTS idx_audit_logs_company ON audit_logs(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS help_manual (
    id VARCHAR(50) PRIMARY KEY DEFAULT 'default',
    title VARCHAR(200) NOT NULL DEFAULT 'Manual Integral de Uso y Operación',
    content TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);


