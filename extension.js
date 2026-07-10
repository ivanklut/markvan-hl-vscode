const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

function activate(context) {
    console.log('Markvan extension is now active!');

    // Функция вычисления чистого пути к файлу (без хэша)
    function getFullPath(document, linkTarget) {
        const cleanTarget = linkTarget.split('#')[0].trim();
        if (cleanTarget.startsWith('/')) {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
            if (workspaceFolder) {
                return path.join(workspaceFolder.uri.fsPath, cleanTarget.substring(1));
            }
        }
        return path.resolve(path.dirname(document.uri.fsPath), cleanTarget);
    }

    // Регистрация команды для сложного перехода к якорю
    let openLinkedFileCommand = vscode.commands.registerCommand('markvan.openFileAtAnchor', async (filePath, anchor) => {
        if (!fs.existsSync(filePath)) return;

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        const editor = await vscode.window.showTextDocument(doc);

        if (!anchor) return;

        const text = doc.getText();
        // ИСПРАВЛЕНО: Теперь ищет строго упрощенные трехсимвольные маркеры заголовков по спецификации
        const anchorRegex = new RegExp(`^(===|---|\\.\\.\\.|,,,|:::|;;;)\\s+#${anchor}$`, 'm');
        const match = anchorRegex.exec(text);

        if (match) {
            const pos = doc.positionAt(match.index);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }
    });

    // Провайдер DocumentLink
    let linkProvider = vscode.languages.registerDocumentLinkProvider('markvan', {
        provideDocumentLinks(document) {
            const links = [];
            const text = document.getText();
            
            // ИСПРАВЛЕНО: Добавлен маркер |-> в список отслеживания начала ссылок
            const regex = /(?:\|>>?\s*|\|->\s*|<\[\s*|\[\[\s*|\{\{\s*)[#\w\d\/\-.а-яА-ЯёЁ!_~+=# ]+?(?=\s*\||[\r\n]|\]>|\]...|\]\]|\}\}|$)/g;
            let match;

            while ((match = regex.exec(text)) !== null) {
                const fullMatch = match[0];
                // ИСПРАВЛЕНО: Префикс теперь тоже умеет ловить |->
                const prefixMatch = fullMatch.match(/^(\|>>?\s*|\|->\s*|<\[\s*|\[\[\s*|\{\{\s*)/);
                const prefixLength = prefixMatch ? prefixMatch[0].length : 0;
                const linkTarget = fullMatch.substring(prefixLength).trim();

                if (!linkTarget) continue;

                const startOffset = match.index + prefixLength;
                const range = new vscode.Range(
                    document.positionAt(startOffset),
                    document.positionAt(startOffset + linkTarget.length)
                );

                if (linkTarget.startsWith('#')) {
                    // Локальный прыжок внутри ОДНОГО файла
                    const anchor = linkTarget.substring(1);
                    // ИСПРАВЛЕНО: Локальный поиск тоже переведен на новые чистые заголовки
                    const anchorRegex = new RegExp(`^(===|---|\\.\\.\\.|,,,|:::|;;;)\\s+#${anchor}$`, 'm');
                    const anchorMatch = anchorRegex.exec(text);

                    if (anchorMatch) {
                        const targetPos = document.positionAt(anchorMatch.index);
                        const uri = document.uri.with({ fragment: (targetPos.line + 1).toString() });
                        links.push(new vscode.DocumentLink(range, uri));
                    }
                } else {
                    // Перекрестный прыжок между файлами с прокруткой
                    const parts = linkTarget.split('#');
                    const filePart = parts[0].trim();
                    const anchorPart = parts[1] ? parts[1].trim() : null;

                    const fullPath = getFullPath(document, filePart);
                    
                    if (fs.existsSync(fullPath)) {
                        const query = encodeURIComponent(JSON.stringify([fullPath, anchorPart]));
                        const commandUri = vscode.Uri.parse(`command:markvan.openFileAtAnchor?${query}`);
                        
                        const docLink = new vscode.DocumentLink(range, commandUri);
                        docLink.tooltip = anchorPart ? `Перейти к #${anchorPart} в файле` : 'Открыть файл';
                        links.push(docLink);
                    }
                }
            }
            return links;
        }
    });

    // Провайдер Hover (сохраняем стабильную версию)
    let hoverProvider = vscode.languages.registerHoverProvider('markvan', {
        provideHover(document, position) {
            const imageRange = document.getWordRangeAtPosition(position, /[\w\d\/\-.а-яА-ЯёЁ\s]+\.(png|jpg|jpeg|gif|svg|webp)/i);
            if (imageRange) {
                const fileName = document.getText(imageRange).trim();
                const fullPath = getFullPath(document, fileName); 

                if (fs.existsSync(fullPath)) {
                    const uri = vscode.Uri.file(fullPath);
                    const md = new vscode.MarkdownString(`### Image Preview\n\n![${fileName}](${uri.toString()})`);
                    md.isTrusted = true;
                    return new vscode.Hover(md);
                }
            }
            return null;
        }
    });

    context.subscriptions.push(openLinkedFileCommand, hoverProvider, linkProvider);
}

exports.activate = activate;
function deactivate() {}
exports.deactivate = deactivate;
