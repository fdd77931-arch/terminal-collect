-- ============================================================
--  终端填报 · Supabase 建表脚本（收集 + 口令报告）
--  用法：Supabase 控制台 → SQL Editor → 新建查询 → 粘贴执行
--
--  权限模型：
--    匿名（提交人）：只能 INSERT，读不到任何数据
--    管理员：凭口令调用 report_rows() 才能拿到全部数据
-- ============================================================

create table if not exists public.submissions (
  id           uuid primary key default gen_random_uuid(),
  terminal_id  text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now()
);

create index if not exists submissions_terminal_idx on public.submissions (terminal_id, created_at desc);
create index if not exists submissions_created_idx  on public.submissions (created_at desc);

alter table public.submissions enable row level security;

-- 提交：只允许插入。没有 select / update / delete 策略，匿名用户就改不了也看不到。
drop policy if exists submissions_insert on public.submissions;
create policy submissions_insert on public.submissions
  for insert to anon with check (true);

-- ------------------------------------------------------------
--  管理口令（改成你自己的，别用默认值）
--  改完只需重新执行这一个函数
-- ------------------------------------------------------------
create or replace function public.report_rows(pass text)
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if pass is distinct from 'change-me-2026' then
    raise exception 'bad passcode' using errcode = '28000';
  end if;

  return query
    select s.payload
    from public.submissions s
    order by s.created_at desc;
end;
$$;

-- 连通性测试（设置页“测试连接”用）
create or replace function public.ping()
returns boolean
language sql
security definer
set search_path = public
as $$ select true $$;

grant execute on function public.report_rows(text) to anon;
grant execute on function public.ping() to anon;

-- ------------------------------------------------------------
--  可选：同一终端保留全部历史，报告页按“最新一次”汇总。
--  想限制重复次数，可以加一个触发器，但不建议——留痕更有用。
-- ------------------------------------------------------------

-- 可选：看看谁在什么时候交了什么
-- select created_at, terminal_id, payload->>'reporter' as reporter, payload->>'name' as 终端
-- from public.submissions order by created_at desc limit 50;
