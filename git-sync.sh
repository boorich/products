#!/bin/bash
# Git sync script that handles rebase automatically
# Usage: ./git-sync.sh [commit-message]

set -e

# Pull with rebase to integrate any GitHub API commits
echo "📥 Pulling latest changes (with rebase)..."
git pull --rebase

# If there are uncommitted changes, commit them
if ! git diff-index --quiet HEAD --; then
    if [ -z "$1" ]; then
        echo "❌ You have uncommitted changes. Please commit them first or provide a commit message."
        echo "Usage: ./git-sync.sh 'Your commit message'"
        exit 1
    fi
    
    echo "📝 Committing changes..."
    git add -A
    git commit -m "$1"
fi

# Push to remote
echo "📤 Pushing to remote..."
git push

echo "✅ Sync complete!"

