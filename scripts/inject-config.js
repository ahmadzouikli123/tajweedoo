#!/usr/bin/env node
/**
 * scripts/inject-config.js
 *
 * يشتغل تلقائيًا كـ Build Command على Vercel (راجع vercel.json).
 * يقرأ القيم من متغيرات بيئة Vercel، ويحدد staging أو production
 * اعتمادًا على VERCEL_ENV اللي توفرها Vercel نفسها وقت البناء:
 *   - "production"          → عند تشغيل: vercel deploy --prod
 *   - "preview" أو غيرها    → عند تشغيل: vercel deploy   (بدون --prod)
 *
 * للتجربة المحلية بدون Vercel:
 *   VERCEL_ENV=preview node scripts/inject-config.js
 */
const fs = require('fs');
const path = require('path');

const vercelEnv = process.env.VERCEL_ENV || 'preview';
const target = vercelEnv === 'production' ? 'production' : 'staging';

const REQUIRED = {
    production: {
        endpoint: 'APPWRITE_ENDPOINT_PROD',
        projectId: 'APPWRITE_PROJECT_ID_PROD',
        databaseId: 'APPWRITE_DATABASE_ID_PROD',
        securityFunctionId: 'SECURITY_FUNCTION_ID_PROD',
        recitationsBucketId: 'RECITATIONS_BUCKET_ID_PROD',
    },
    staging: {
        endpoint: 'APPWRITE_ENDPOINT_STAGING',
        projectId: 'APPWRITE_PROJECT_ID_STAGING',
        databaseId: 'APPWRITE_DATABASE_ID_STAGING',
        securityFunctionId: 'SECURITY_FUNCTION_ID_STAGING',
        recitationsBucketId: 'RECITATIONS_BUCKET_ID_STAGING',
    },
};

const envVarNames = REQUIRED[target];
const config = {};
const missing = [];
for (const [key, envVarName] of Object.entries(envVarNames)) {
    const value = process.env[envVarName];
    if (!value) missing.push(envVarName);
    config[key] = value;
}

if (missing.length > 0) {
    console.error(`متغيرات بيئة ناقصة على Vercel لبيئة "${target}" (VERCEL_ENV=${vercelEnv}):`);
    missing.forEach((name) => console.error(`  - ${name}`));
    console.error('أضفها بـ: vercel env add <NAME> ' + (target === 'production' ? 'production' : 'preview'));
    process.exit(1);
}

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'index.html');
const outDir = path.join(repoRoot, 'dist');
const outPath = path.join(outDir, 'index.html');

if (!fs.existsSync(sourcePath)) {
    console.error(`ملف المصدر غير موجود: ${sourcePath}`);
    process.exit(1);
}

const placeholderMap = {
    '__APPWRITE_ENDPOINT__': config.endpoint,
    '__APPWRITE_PROJECT_ID__': config.projectId,
    '__APPWRITE_DATABASE_ID__': config.databaseId,
    '__SECURITY_FUNCTION_ID__': config.securityFunctionId,
    '__RECITATIONS_BUCKET_ID__': config.recitationsBucketId,
};

let html = fs.readFileSync(sourcePath, 'utf8');
let replacedCount = 0;
for (const [placeholder, value] of Object.entries(placeholderMap)) {
    const before = html;
    html = html.split(placeholder).join(value);
    if (html !== before) replacedCount++;
}

if (replacedCount === 0) {
    console.error(
        'ما تم إيجاد أي placeholder داخل index.html.\n' +
        'يبدو إن index.html لسه فيه القيم الثابتة (hardcoded) بدل الـ placeholders.\n' +
        'راجع "الخطوة 1" في README-deploy.md قبل ما تشغّل هذا السكربت.'
    );
    process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, html, 'utf8');
console.log(`تم بناء dist/index.html لبيئة "${target}" (مشروع Appwrite: ${config.projectId})`);
