// ============================================================================
// تجويدو — دالة أمان (Appwrite Function)
// ============================================================================
// الغرض: بعض المستندات (الطالب، تسجيل التلاوة، محاولة الاختبار) تُنشأ من
// المتصفح بصلاحية Permission.read/update(Role.users()) لأن جلسة العميل
// (طالب أو معلم) لا تقدر تمنح صلاحية لمستخدم آخر بعينه. هذه الدالة تعمل
// بمفتاح API سري (صلاحيات خادم كاملة) فتقدر تمنح الصلاحية للشخص الصحيح
// بالضبط، ثم *تزيل* Role.users() نهائيًا من نفس المستند.
//
// كل استدعاء يُتحقق فيه من هوية المستخدم المتصل (مُمرَّرة تلقائيًا من
// Appwrite بالترويسة x-appwrite-user-id عند التنفيذ بجلسة مستخدم مسجَّل) ومن
// أن العلاقة منطقية فعلاً (مثلاً: المتصل هو فعلاً معلم هذا الفصل بالذات)
// قبل تنفيذ أي تعديل — هذا يمنع أي مستخدم من استغلال الدالة لسرقة صلاحية
// وصول لبيانات لا تخصه.
//
// ⚠️ ملاحظة: أسماء ترويسات هوية المستخدم (x-appwrite-user-id) قد تختلف
// حسب إصدار Appwrite — تحقق من توثيق Appwrite الحالي لـ "Functions" قبل
// النشر النهائي، فقد يتطلب إصدارك تمرير JWT من العميل بدل الاعتماد على
// الترويسة التلقائية.
// ============================================================================

import { Client, Databases, Storage, Permission, Role } from 'node-appwrite';

export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT || process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID || process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY); // مفتاح API سري — يُضبط كمتغيّر بيئة سرّي بلوحة الدالة، لا يوضع بالكود أبدًا

  const databases = new Databases(client);
  const storage = new Storage(client);
  const DB_ID = process.env.APPWRITE_DATABASE_ID;
  const RECITATIONS_BUCKET_ID = process.env.APPWRITE_RECITATIONS_BUCKET_ID;

  const COL = {
    teachers: 'teachers',
    classrooms: 'classrooms',
    students: 'students',
    quizzes: 'quizzes',
    quizAttempts: 'quiz_attempts',
    recitationReviews: 'recitation_reviews',
  };

  // هوية المستخدم المتصل — تُمرَّر تلقائيًا من Appwrite عند التنفيذ بجلسة مستخدم حقيقية
  const callerId = req.headers['x-appwrite-user-id'];
  if (!callerId) {
    return res.json({ ok: false, error: 'غير مصرَّح — لا توجد جلسة مستخدم صالحة' }, 401);
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.json({ ok: false, error: 'جسم الطلب غير صالح' }, 400);
  }

  const { action, documentId } = body || {};

  try {
    // ------------------------------------------------------------------
    // 1) قفل مستند الطالب: يُستدعى فورًا بعد teacherRegisterStudent
    //    الشرط: المتصل يجب أن يكون فعلاً معلم الفصل الذي يتبعه هذا الطالب
    // ------------------------------------------------------------------
    if (action === 'lockStudentDoc') {
      const student = await databases.getDocument(DB_ID, COL.students, documentId);
      const classroom = await databases.getDocument(DB_ID, COL.classrooms, student.classroomId);

      if (classroom.teacherId !== callerId) {
        return res.json({ ok: false, error: 'المتصل ليس معلم هذا الفصل' }, 403);
      }

      await databases.updateDocument(DB_ID, COL.students, documentId, undefined, [
        Permission.read(Role.user(callerId)),
        Permission.update(Role.user(callerId)),
        Permission.delete(Role.user(callerId)),
        Permission.read(Role.user(student.userId)),
        Permission.update(Role.user(student.userId)),
      ]);

      return res.json({ ok: true });
    }

    // ------------------------------------------------------------------
    // 2) قفل مستند مراجعة التلاوة: يُستدعى فورًا بعد uploadRecitation
    //    الشرط: المتصل يجب أن يكون فعلاً صاحب التسجيل (الطالب)
    // ------------------------------------------------------------------
    if (action === 'lockRecitationDoc') {
      const review = await databases.getDocument(DB_ID, COL.recitationReviews, documentId);

      if (review.studentId !== callerId) {
        return res.json({ ok: false, error: 'المتصل ليس صاحب هذا التسجيل' }, 403);
      }

      const classroom = await databases.getDocument(DB_ID, COL.classrooms, review.classroomId);

      await databases.updateDocument(DB_ID, COL.recitationReviews, documentId, undefined, [
        Permission.read(Role.user(callerId)),
        Permission.update(Role.user(callerId)),
        Permission.delete(Role.user(callerId)), // يسمح للطالب بحذف تسجيله
        Permission.read(Role.user(classroom.teacherId)),
        Permission.update(Role.user(classroom.teacherId)), // يحتاجها المعلم لإضافة ملاحظاته لاحقًا
        Permission.delete(Role.user(classroom.teacherId)), // يسمح للمعلم بحذف التسجيل
      ]);

      // نقفل أيضًا صلاحيات ملف الصوت نفسه بمساحة التخزين (مو فقط مستند المراجعة)
      if (RECITATIONS_BUCKET_ID && review.audioFileId) {
        await storage.updateFile(RECITATIONS_BUCKET_ID, review.audioFileId, undefined, [
          Permission.read(Role.user(callerId)),
          Permission.update(Role.user(callerId)),
          Permission.delete(Role.user(callerId)),
          Permission.read(Role.user(classroom.teacherId)),
          Permission.delete(Role.user(classroom.teacherId)), // يسمح للمعلم بحذف ملف التسجيل
        ]);
      }

      return res.json({ ok: true });
    }

    // ------------------------------------------------------------------
    // 3) قفل مستند محاولة الاختبار: يُستدعى فورًا بعد submitQuizAttempt
    //    الشرط: المتصل يجب أن يكون فعلاً صاحب المحاولة (الطالب)
    // ------------------------------------------------------------------
    if (action === 'lockQuizAttemptDoc') {
      const attempt = await databases.getDocument(DB_ID, COL.quizAttempts, documentId);

      if (attempt.studentId !== callerId) {
        return res.json({ ok: false, error: 'المتصل ليس صاحب هذه المحاولة' }, 403);
      }

      const quiz = await databases.getDocument(DB_ID, COL.quizzes, attempt.quizId);

      await databases.updateDocument(DB_ID, COL.quizAttempts, documentId, undefined, [
        Permission.read(Role.user(callerId)),
        Permission.update(Role.user(callerId)),
        Permission.read(Role.user(quiz.teacherId)),
      ]);

      return res.json({ ok: true });
    }

    return res.json({ ok: false, error: 'action غير معروف' }, 400);
  } catch (e) {
    error(e.message);
    return res.json({ ok: false, error: 'فشل داخلي، راجع سجلات الدالة' }, 500);
  }
};
