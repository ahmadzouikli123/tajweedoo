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
 * يعالج كل ملف بقائمة SOURCE_FILES أدناه (حاليًا: index.html و admin.html) —
 * أي ملف HTML جديد يحتاج نفس القيم يُضاف لهذي القائمة بس، بدون تكرار الكود.
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
        loginFailureFunctionId: 'LOGIN_FAILURE_FUNCTION_ID_PROD',
    },
    staging: {
        endpoint: 'APPWRITE_ENDPOINT_STAGING',
        projectId: 'APPWRITE_PROJECT_ID_STAGING',
        databaseId: 'APPWRITE_DATABASE_ID_STAGING',
        securityFunctionId: 'SECURITY_FUNCTION_ID_STAGING',
        recitationsBucketId: 'RECITATIONS_BUCKET_ID_STAGING',
        loginFailureFunctionId: 'LOGIN_FAILURE_FUNCTION_ID_STAGING',
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
const outDir = path.join(repoRoot, 'dist');

const placeholderMap = {
    '__APPWRITE_ENDPOINT__': config.endpoint,
    '__APPWRITE_PROJECT_ID__': config.projectId,
    '__APPWRITE_DATABASE_ID__': config.databaseId,
    '__SECURITY_FUNCTION_ID__': config.securityFunctionId,
    '__RECITATIONS_BUCKET_ID__': config.recitationsBucketId,
    '__LOGIN_FAILURE_FUNCTION_ID__': config.loginFailureFunctionId,
};

// كل ملف HTML بجذر المشروع يحتاج حقن نفس القيم فيه وقت البناء — أضف أي ملف
// جديد هنا (زي صفحات لوحات إدارية مستقبلية) بدل تكرار منطق الحقن يدويًا.
const SOURCE_FILES = ['index.html', 'admin.html'];

fs.mkdirSync(outDir, { recursive: true });

let anyFileProcessed = false;

for (const fileName of SOURCE_FILES) {
    const sourcePath = path.join(repoRoot, fileName);
    if (!fs.existsSync(sourcePath)) {
        console.log(`تخطي "${fileName}" — الملف غير موجود بجذر المشروع (تجاهل هذا لو الملف اختياري).`);
        continue;
    }

    let html = fs.readFileSync(sourcePath, 'utf8');
    let replacedCount = 0;
    for (const [placeholder, value] of Object.entries(placeholderMap)) {
        const before = html;
        html = html.split(placeholder).join(value);
        if (html !== before) replacedCount++;
    }

    if (replacedCount === 0) {
        console.error(
            `ما تم إيجاد أي placeholder داخل ${fileName}.\n` +
            `يبدو إن ${fileName} لسه فيه القيم الثابتة (hardcoded) بدل الـ placeholders.\n` +
            'راجع "الخطوة 1" في README-deploy.md قبل ما تشغّل هذا السكربت.'
        );
        process.exit(1);
    }

    const outPath = path.join(outDir, fileName);
    fs.writeFileSync(outPath, html, 'utf8');
    console.log(`تم بناء dist/${fileName} لبيئة "${target}" (مشروع Appwrite: ${config.projectId})`);
    anyFileProcessed = true;
}

if (!anyFileProcessed) {
    console.error('لم يُعالَج أي ملف من SOURCE_FILES — تأكد من وجود index.html بجذر المشروع على الأقل.');
    process.exit(1);
}
