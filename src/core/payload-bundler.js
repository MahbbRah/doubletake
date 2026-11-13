import fs from 'node:fs';
import path from 'node:path';

export class PayloadBundler {
  static getExtensionLang(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
      '.js': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'tsx',
      '.jsx': 'jsx',
      '.py': 'python',
      '.json': 'json',
      '.md': 'markdown',
      '.html': 'html',
      '.css': 'css',
      '.sh': 'bash',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.rs': 'rust',
      '.go': 'go'
    };
    return map[ext] || '';
  }

  static preparePayload({ files = [], diff = '', cwd = process.cwd() }) {
    const fileContents = [];
    const filesToUpload = [];
    let totalTextBytes = 0;

    for (const fileInput of files) {
      const fullPath = path.isAbsolute(fileInput) ? fileInput : path.resolve(cwd, fileInput);
      if (!fs.existsSync(fullPath)) {
        continue;
      }

      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        continue;
      }

      // If file is very large (> 250 KB), mark for upload attachment instead of inline text
      if (stat.size > 250 * 1024) {
        filesToUpload.push(fullPath);
      } else {
        const content = fs.readFileSync(fullPath, 'utf-8');
        totalTextBytes += content.length;
        fileContents.push({
          path: path.relative(cwd, fullPath) || path.basename(fullPath),
          fullPath,
          lang: this.getExtensionLang(fullPath),
          content
        });
      }
    }

    // If total text size exceeds 60 KB (~15,000 words), also suggest uploading as file
    if (totalTextBytes > 60 * 1024) {
      // Put them into filesToUpload to avoid composer paste lag
      for (const item of fileContents) {
        filesToUpload.push(item.fullPath);
      }
      return {
        fileContents: [],
        filesToUpload,
        diff
      };
    }

    return {
      fileContents,
      filesToUpload,
      diff
    };
  }
}
