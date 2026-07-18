// ============================================================================
// تجويدو — دالة أمان (Appwrite Function) — مشروع الإنتاج
// ============================================================================
// الغرض: بعض الصفوف (الطالب، تسجيل التلاوة، محاولة الاختبار) تُنشأ من
// المتصفح بصلاحية Permission.read/update(Role.users()) لأن جلسة العميل
// (طالب أو معلم) لا تقدر تمنح صلاحية لمستخدم آخر بعينه. هذه الدالة تعمل
// بمفتاح API سري (صلاحيات خادم كاملة) فتقدر تمنح الصلاحية للشخص الصحيح
// بالضبط، ثم *تزيل* Role.users() نهائيًا من نفس الصف.
//
// ⚠️ يستخدم TablesDB API الحالي (getRow/updateRow/listRows) بدل Databases
// API القديم المتوقف (getDocument/updateDocument/listDocuments) — نفس
// التصحيح المطبّق على نسخة مشروع التجربة، بالإضافة لثلاث إجراءات كانت
// موجودة بالإنتاج فقط: syncClassroomAccess, updateStudentCredentials,
// syncQuizAccess.
// ============================================================================

import { Client, TablesDB, Storage, Users, Query, Permission, Role } from 'node-appwrite';

export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT || process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID || process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const tablesDB = new TablesDB(client);
  const storage = new Storage(client);
  const users = new Users(client);
  const DB_ID = process.env.APPWRITE_DATABASE_ID;
  const RECITATIONS_BUCKET_ID = process.env.APPWRITE_RECITATIONS_BUCKET_ID;

  const TBL = {
    teachers: 'teachers',
    classrooms: 'classrooms',
    students: 'students',
    quizzes: 'quizzes',
    questions: 'questions',
    quizAttempts: 'quiz_attempts',
    recitationReviews: 'recitation_reviews',
  };

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

  const { action, documentId, newUsername, newPassword } = body || {};

  try {
    // ------------------------------------------------------------------
    // 1) قفل صف الطالب: يُستدعى فورًا بعد teacherRegisterStudent
    //    الشرط: المتصل يجب أن يكون فعلاً معلم الفصل الذي يتبعه هذا الطالب
    // ------------------------------------------------------------------
    if (action === 'lockStudentDoc') {
      const student = await tablesDB.getRow({ databaseId: DB_ID, tableId: TBL.students, rowId: documentId });
      const classroom = await tablesDB.getRow({ databaseId: DB_ID, tableId: TBL.classrooms, rowId: student.classroomId });

      if (classroom.teacherId !== callerId) {
        return res.json({ ok: false, error: 'المتصل ليس معلم هذا الفصل' }, 403);
      }

      await tablesDB.updateRow({
        databaseId: DB_ID, tableId: TBL.students, rowId: documentId, data: {},
        permissions: [
          Permission.read(Role.user(callerId)),
          Permission.update(Role.user(callerId)),
          Permission.delete(Role.user(callerId)),
          Permission.read(Role.user(student.userId)),
          Permission.update(Role.user(student.userId)),
        ],
      });

      // يمنح الطالب صلاحية قراءة فصله (اسمه ورابط الاجتماع) دون فتحها لكل المستخدمين،
      // مع الحفاظ على أي صلاحيات موجودة مسبقًا (مثل صلاحيات طلاب آخرين بنفس الفصل)
      const existingClassroomPerms = new Set(classroom.$permissions || []);
      existingClassroomPerms.add(Permission.read(Role.user(student.userId)));
      await tablesDB.updateRow({
        databaseId: DB_ID, tableId: TBL.classrooms, rowId: classroom.$id, data: {},
        permissions: Array.from(existingClassroomPerms),
      });

      return res.json({ ok: true });
    }

    // ------------------------------------------------------------------
    // 2) قفل صف مراجعة التلاوة: يُستدعى فورًا بعد uploadRecitation
    //    الشرط: المتصل يجب أن يكون فعلاً صاحب التسجيل (الطالب)
    // ------------------------------------------------------------------
    if (action === 'lockRecitationDoc') {
      const review = await tablesDB.getRow({ databaseId: DB_ID, tableId: TBL.recitationReviews, rowId: documentId });

      if (review.studentId !== callerId) {
        return res.json({ ok: false, error: 'المتصل ليس صاحب هذا التسجيل' }, 403);
      }

      const classroom = await tablesDB.getRow({ databaseId: DB_ID, tableId: TBL.classrooms, rowId: review.classroomId });

      await tablesDB.updateRow({
        databaseId: DB_ID, tableId: TBL.recitationReviews, rowId: documentId, data: {},
        permissions: [
          Permission.read(Role.user(callerId)),
          Permission.update(Role.user(callerId)),
          Permission.delete(Role.user(callerId)), // يسمح للطالب بحذف تسجيله
          Permission.read(Role.user(classroom.teacherId)),
          Permission.update(Role.user(classroom.teacherId)), // يحتاجها المعلم لإضافة ملاحظاته لاحقًا
          Permission.delete(Role.user(classroom.teacherId)), // يسمح للمعلم بحذف التسجيل
        ],
      });

      if (RECITATIONS_BUCKET_ID && review.audioFileId) {
        await storage.updateFile({
          bucketId: RECITATIONS_BUCKET_ID, fileId: review.audioFileId,
          permissions: [
            Permission.read(Role.user(callerId)),
            Permission.update(Role.user(callerId)),
            Permission.delete(Role.user(callerId)),
            Permission.read(Role.user(classroom.teacherId)),
            Permission.delete(Role.user(classroom.teacherId)), // يسمح للمعلم بحذف ملف التسجيل
          ],
        });
      }

      return res.json({ ok: true });
    }

    // ------------------------------------------------------------------
    // 3) قفل صف محاولة الاختبار: يُستدعى فورًا بعد submitQuizAttempt
    //    الشرط: المتصل يجب أن يكون فعلاً صاحب المحاولة (الطالب)
    // ------------------------------------------------------------------
    if (action === 'lockQuizAttemptDoc') {
      const attempt = await tablesDB.getRow({ databaseId: DB_ID, tableId: TBL.quizAttempts, rowId: documentId });

      if (attempt.studentId !== callerId) {
        return res.json({ ok: false, error: 'المتصل ليس صاحب هذه المحاولة' }, 403);
      }

      const quiz = await tablesDB.getRow({ databaseId: DB_ID, tableId: TBL.quizzes, rowId: attempt.quizId });

      await tablesDB.updateRow({
        databaseId: DB_ID, tableId: TBL.quizAttempts, rowId: documentId, data: {},
        permissions: [
          Permission.read(Role.user(callerId)),
          Permission.update(Role.user(callerId)),
          Permission.read(Role.user(quiz.teacherId)),
        ],
      });

      return res.json({ ok: true });
    }

    // ------------------------------------------------------------------
    // 4) يزامن صلاحية قراءة الفصل لكل طلابه الحاليين — يُستدعى مثلاً بعد
    //    حفظ المعلم لرابط اجتماع Teams، حتى يقدر كل طالب بالفصل يشوفه
    //    (بمن فيهم الطلاب اللي انسجلوا قبل تفعيل هذا الإجراء)
    //    الشرط: المتصل يجب أن يكون فعلاً معلم هذا الفصل
    // ------------------------------------------------------------------
    if (action === 'syncClassroomAccess') {
      const classroom = await tablesDB.getRow({ databaseId: DB_ID, tableId: TBL.classrooms, rowId: documentId });

      if (classroom.teacherId !== callerId) {
        return res.json({ ok: false, error: 'المتصل ليس معلم هذا الفصل' }, 403);
      }

      const studentsResult = await tablesDB.listRows({
        databaseId: DB_ID, tableId: TBL.students,
        queries: [Query.equal('classroomId', documentId), Query.limit(500)],
      });

      const perms = new Set(classroom.$permissions || []);
      perms.add(Permission.read(Role.user(callerId)));
      perms.add(Permission.update(Role.user(callerId)));
      perms.add(Permission.delete(Role.user(callerId)));
      for (const s of studentsResult.rows) {
        if (s.userId) perms.add(Permission.read(Role.user(s.userId)));
      }

      await tablesDB.updateRow({
        databaseId: DB_ID, tableId: TBL.classrooms, rowId: documentId, data: {},
        permissions: Array.from(perms),
      });

      return res.json({ ok: true, studentsSynced: studentsResult.rows.length });
    }

    // ------------------------------------------------------------------
    // 5) تعديل اسم مستخدم الطالب و/أو كلمة مروره — يحتاج صلاحيات خادم لأن
    //    تغيير بريد/كلمة مرور حساب مستخدم آخر غير ممكن من جلسة عميل عادية.
    //    الشرط: المتصل يجب أن يكون فعلاً معلم فصل هذا الطالب.
    // ------------------------------------------------------------------
    if (action === 'updateStudentCredentials') {
      const student = await tablesDB.getRow({ databaseId: DB_ID, tableId: TBL.students, rowId: documentId });
      const classroom = await tablesDB.getRow({ databaseId: DB_ID, tableId: TBL.classrooms, rowId: student.classroomId });

      if (classroom.teacherId !== callerId) {
        return res.json({ ok: false, error: 'المتصل ليس معلم هذا الطالب' }, 403);
      }

      try {
        if (newUsername) {
          const newEmail = `${newUsername}@tajweedoo.local`;
          await users.updateEmail(student.userId, newEmail);
          await tablesDB.updateRow({
            databaseId: DB_ID, tableId: TBL.students, rowId: documentId,
            data: { username: newUsername },
          });
        }
        if (newPassword) {
          await users.updatePassword(student.userId, newPassword);
        }
      } catch (e) {
        if (e.type === 'user_email_already_exists' || e.code === 409) {
          return res.json({ ok: false, error: 'اسم المستخدم هذا مُستخدم من قبل شخص آخر، جرّب اسمًا مختلفًا' }, 409);
        }
        throw e;
      }

      return res.json({ ok: true });
    }

    // ------------------------------------------------------------------
    // 6) يقفل صلاحيات اختبار كامل (الصف نفسه + كل أسئلته دفعة وحدة):
    //    يُستدعى بعد إنشاء الاختبار، وبعد إضافة/تعديل أي سؤال فيه — يمنح
    //    القراءة فقط لمعلم الاختبار + طلاب فصله الحاليين، بدل فتحها لأي
    //    مستخدم مسجَّل دخول (Role.users()). الشرط: المتصل معلم هذا الاختبار.
    // ------------------------------------------------------------------
    if (action === 'syncQuizAccess') {
      const quiz = await tablesDB.getRow({ databaseId: DB_ID, tableId: TBL.quizzes, rowId: documentId });

      if (quiz.teacherId !== callerId) {
        return res.json({ ok: false, error: 'المتصل ليس معلم هذا الاختبار' }, 403);
      }

      const studentsResult = await tablesDB.listRows({
        databaseId: DB_ID, tableId: TBL.students,
        queries: [Query.equal('classroomId', quiz.classroomId), Query.limit(500)],
      });

      const perms = [
        Permission.read(Role.user(callerId)),
        Permission.update(Role.user(callerId)),
        Permission.delete(Role.user(callerId)),
        ...studentsResult.rows.filter(s => s.userId).map(s => Permission.read(Role.user(s.userId))),
      ];

      await tablesDB.updateRow({
        databaseId: DB_ID, tableId: TBL.quizzes, rowId: documentId, data: {}, permissions: perms,
      });

      const questionsResult = await tablesDB.listRows({
        databaseId: DB_ID, tableId: TBL.questions,
        queries: [Query.equal('quizId', documentId), Query.limit(500)],
      });
      for (const q of questionsResult.rows) {
        await tablesDB.updateRow({
          databaseId: DB_ID, tableId: TBL.questions, rowId: q.$id, data: {}, permissions: perms,
        });
      }

      return res.json({ ok: true, questionsSynced: questionsResult.rows.length });
    }

    return res.json({ ok: false, error: 'action غير معروف' }, 400);
  } catch (e) {
    error(e.message);
    return res.json({ ok: false, error: 'فشل داخلي، راجع سجلات الدالة' }, 500);
  }
};
