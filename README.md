# Cartoon Clock (Slimy) v0.8.1b

GitHub Pages でそのまま公開できるように整えた最小構成です。  
`index.html` と `src/main.js` だけの静的サイトなので、**フォルダごと GitHub にアップロード**すれば公開できます。

## 使い方（ローカル）
- `index.html` をブラウザで開くか、VS Code の Live Server などで開いてください。

## 公開手順（GitHub Pages）
1. GitHub に新しいリポジトリ（例: `Cartoon_Clock`）を作成します。
2. このフォルダの中身（`index.html` と `src/` 一式）をリポジトリの **ルート直下** にアップロードします。  
   （GitHub 画面の **Add file → Upload files** でドラッグ&ドロップして OK）
3. リポジトリの **Settings → Pages** を開き、
   - **Build and deployment → Source** を **Deploy from a branch** にする
   - **Branch** を **main**、**/ (root)** を選び **Save**
4. 数十秒〜数分後、**Pages** セクションに公開 URL（例: `https://rea2525.github.io/Cartoon_Clock/`）が表示されます。
   - ※無料プランでは **Public** リポジトリのみ公開可能です。Private のまま公開したい場合は GitHub Pro 等が必要です。

## コミット用コマンド例（ターミナル）
### (A) 既存の空リポジトリに最初のファイルをプッシュ
```bash
cd /path/to/Cartoon_Clock    # このフォルダに移動（index.html と src/ がある階層）
git init
git branch -M main
git add .
git commit -m "Add Cartoon Clock slimy v0.8.1b (GitHub Pages ready)"
git remote add origin https://github.com/rea2525/Cartoon_Clock.git
git push -u origin main
```

### (B) すでに clone 済みのリポジトリに追加する場合
```bash
git clone https://github.com/rea2525/Cartoon_Clock.git
cd Cartoon_Clock
# ← ここへ index.html と src/ を置く（上書き or 追加）
git add .
git commit -m "Add Cartoon Clock slimy v0.8.1b"
git push -u origin main
```

## 備考
- ブラウザのカメラ API（getUserMedia）を使う場合、**HTTPS** が必須です。GitHub Pages は HTTPS なのでそのまま動作します。
- 文字は Google Fonts の **Noto Sans 100** を使用しています（CDN 参照）。
- 不要な macOS の隠しファイル（`.DS_Store` 等）は `.gitignore` で無視するようにしています。