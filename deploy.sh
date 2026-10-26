#!/usr/bin/env bash
# ============================================================
#  终端数据填报 · 一键部署到 GitHub Pages
#
#  用法：
#    bash deploy.sh              # 真正部署
#    bash deploy.sh --dry-run    # 只演练，不推送
#
#  想换仓库名：REPO=my-name bash deploy.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

OWNER="fdd77931-arch"
REPO="${REPO:-terminal-collect}"
BRANCH="main"
PAGES_URL="https://${OWNER}.github.io/${REPO}/"
DRY=0
if [ "${1:-}" = "--dry-run" ]; then DRY=1; fi

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
note() { printf "  · %s\n" "$*"; }
warn() { printf "  ! %s\n" "$*"; }

# ---------- 0. 检查 ----------
command -v git >/dev/null 2>&1 || { echo "没有 git，请先安装：https://git-scm.com/download/mac"; exit 1; }
[ -f index.html ] || { echo "当前目录里没有 index.html，请在 terminal-collect 目录下运行"; exit 1; }

# ---------- 1. 本地仓库 ----------
say "1/5 准备本地仓库"
if [ ! -d .git ]; then
  git init -b "$BRANCH" >/dev/null
  note "初始化 git 仓库（分支 $BRANCH）"
else
  note "已有 git 仓库"
  cur=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  if [ "$cur" != "$BRANCH" ]; then
    git checkout -b "$BRANCH" >/dev/null 2>&1 || git branch -M "$BRANCH"
  fi
fi

git add -A
if git diff --cached --quiet; then
  note "没有新改动"
else
  name=$(git config user.name || true)
  mail=$(git config user.email || true)
  [ -z "$name" ] && git config user.name "$OWNER"
  [ -z "$mail" ] && git config user.email "${OWNER}@users.noreply.github.com"
  git commit -m "deploy: $(date '+%Y-%m-%d %H:%M')" >/dev/null
  note "已提交：$(git log -1 --pretty=%s)"
fi

# ---------- 2. gh CLI ----------
say "2/5 检查 GitHub CLI"
HAS_GH=0
if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    HAS_GH=1
    note "gh 已登录：$(gh api user --jq .login 2>/dev/null || echo '?')"
  else
    warn "装了 gh 但没登录，先执行：gh auth login"
  fi
else
  warn "没装 gh（不影响，下面会给手动命令）"
fi

if [ "$HAS_GH" = "0" ]; then
  cat <<EOF

────────────────────────────────────────────────────────
 手动三步（大约 2 分钟）

 1. 打开 https://github.com/new
    仓库名填：${REPO}
    选 Public，不要勾 "Add a README file"，点 Create repository

 2. 回到这个目录，执行（整段复制）：

    git remote add origin https://github.com/${OWNER}/${REPO}.git 2>/dev/null || git remote set-url origin https://github.com/${OWNER}/${REPO}.git
    git push -u origin ${BRANCH}

 3. 打开 https://github.com/${OWNER}/${REPO}/settings/pages
    Source 选 "Deploy from a branch" → Branch 选 main、目录 / (root) → Save

 等 1 分钟，打开：${PAGES_URL}
────────────────────────────────────────────────────────
EOF
  exit 0
fi

# ---------- 3. 远程仓库 ----------
say "3/5 创建 / 连接远程仓库"
if gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
  note "仓库已存在：$OWNER/$REPO"
  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "https://github.com/$OWNER/$REPO.git"
  else
    git remote add origin "https://github.com/$OWNER/$REPO.git"
  fi
else
  if [ "$DRY" = "1" ]; then
    note "[dry-run] 会创建仓库 $OWNER/$REPO"
  else
    gh repo create "$OWNER/$REPO" --public --source=. --remote=origin --disable-wiki >/dev/null
    note "已创建：$OWNER/$REPO"
  fi
fi

# ---------- 4. 推送 ----------
say "4/5 推送代码"
if [ "$DRY" = "1" ]; then
  note "[dry-run] 会执行 git push -u origin $BRANCH"
else
  git push -u origin "$BRANCH" 2>&1 | tail -3
fi

# ---------- 5. Pages ----------
say "5/5 打开 GitHub Pages"
if [ "$DRY" = "1" ]; then
  note "[dry-run] 会调用 GitHub API 开启 Pages"
else
  if gh api -X POST "repos/$OWNER/$REPO/pages" \
       -f "source[branch]=$BRANCH" -f "source[path]=/" >/dev/null 2>&1; then
    note "Pages 已开启"
  elif gh api -X PUT "repos/$OWNER/$REPO/pages" \
       -f "source[branch]=$BRANCH" -f "source[path]=/" >/dev/null 2>&1; then
    note "Pages 已更新"
  else
    warn "自动开 Pages 没成功，去 Settings → Pages 手动选 main / root"
  fi
fi

printf "\n\033[1;32m完成。\033[0m 1 分钟后打开：\n\n    %s\n\n" "$PAGES_URL"
cat <<EOF
下一步：
  1. 打开上面的地址 →「设置」→ 存储方式选「云端」
  2. 填 Supabase 的 Project URL 和 anon key → 点「测试连接」
  3. 把 supabase.sql 里的口令改掉，重新执行一次 report_rows 函数
  4. 把链接发群里，自己点「报告」输口令验收

EOF
