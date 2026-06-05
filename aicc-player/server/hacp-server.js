const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

// In-memory session store
const sessions = new Map();

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/**
 * POST /hacp
 * AICC HACP endpoint - handles commands from the course content
 * Commands: GetParam, PutParam, ExitAU
 */
app.post('/hacp', (req, res) => {
  const command = (req.body.command || '').toLowerCase();
  const sessionId = req.body.session_id || '';
  const version = req.body.version || '4.0';

  console.log(`[HACP] Command: ${command}, Session: ${sessionId}`);

  switch (command) {
    case 'getparam':
      handleGetParam(sessionId, res);
      break;
    case 'putparam':
      handlePutParam(sessionId, req.body, res);
      break;
    case 'exitau':
      handleExitAU(sessionId, res);
      break;
    default:
      res.send(buildResponse('error=1\r\nerror_text=Unknown command'));
  }
});

/**
 * POST /hacp/create-session
 * Called by the Angular app before launching a course to create a session
 */
app.post('/hacp/create-session', (req, res) => {
  const { courseId, studentId, studentName } = req.body;
  const sessionId = crypto.randomUUID();

  sessions.set(sessionId, {
    courseId: courseId || '',
    studentId: studentId || 'student_001',
    studentName: studentName || 'Test Student',
    credit: 'credit',
    lessonStatus: 'not attempted',
    entry: 'ab-initio',
    score: '',
    scoreRaw: '',
    scoreMax: '100',
    scoreMin: '0',
    totalTime: '0000:00:00.00',
    sessionTime: '0000:00:00.00',
    lessonLocation: '',
    suspendData: '',
    lessonMode: 'normal',
    masteryScore: '',
    launchData: '',
    comments: '',
    objectives: '',
    createdAt: new Date().toISOString(),
  });

  console.log(`[HACP] Session created: ${sessionId} for course: ${courseId}`);

  res.json({ sessionId });
});

/**
 * GET /hacp/sessions
 * Debug endpoint to view all sessions
 */
app.get('/hacp/sessions', (req, res) => {
  const result = {};
  sessions.forEach((value, key) => {
    result[key] = value;
  });
  res.json(result);
});

function handleGetParam(sessionId, res) {
  const session = sessions.get(sessionId);

  if (!session) {
    res.send(buildResponse('error=1\r\nerror_text=Invalid Session ID'));
    return;
  }

  // Build AICC data according to CMI data model
  const aiccData = [
    'error=0',
    'error_text=Successful',
    'aicc_data=[Core]',
    `Student_ID=${session.studentId}`,
    `Student_Name=${session.studentName}`,
    `Credit=${session.credit}`,
    `Lesson_Status=${session.lessonStatus}`,
    `Entry=${session.entry}`,
    `Score=${session.score}`,
    `Time=${session.totalTime}`,
    `Lesson_Location=${session.lessonLocation}`,
    `Lesson_Mode=${session.lessonMode}`,
    '[Core_Lesson]',
    session.suspendData || '',
    '[Core_Vendor]',
    '',
    '[Comments]',
    session.comments || '',
    '[Objectives_Status]',
    session.objectives || '',
    '[Student_Data]',
    `Mastery_Score=${session.masteryScore}`,
    `Max_Time_Allowed=`,
    `Time_Limit_Action=`,
  ].join('\r\n');

  console.log(`[HACP] GetParam response for session: ${sessionId}`);
  res.send(aiccData);
}

function handlePutParam(sessionId, body, res) {
  const session = sessions.get(sessionId);

  if (!session) {
    res.send(buildResponse('error=1\r\nerror_text=Invalid Session ID'));
    return;
  }

  const aiccData = body.aicc_data || '';
  console.log(`[HACP] PutParam data for session ${sessionId}:\n${aiccData}`);

  // Parse the AICC data and update session
  const parsed = parseAiccData(aiccData);

  if (parsed.lesson_status) session.lessonStatus = parsed.lesson_status;
  if (parsed.score) session.score = parsed.score;
  if (parsed.score_raw) session.scoreRaw = parsed.score_raw;
  if (parsed.time) session.sessionTime = parsed.time;
  if (parsed.lesson_location) session.lessonLocation = parsed.lesson_location;
  if (parsed.suspend_data !== undefined) session.suspendData = parsed.suspend_data;

  // Accumulate total time
  if (parsed.time) {
    session.totalTime = addTimes(session.totalTime, parsed.time);
  }

  // Update entry on subsequent visits
  if (session.lessonStatus === 'incomplete') {
    session.entry = 'resume';
  }

  console.log(`[HACP] Session ${sessionId} updated - Status: ${session.lessonStatus}, Score: ${session.score}`);

  res.send(buildResponse('error=0\r\nerror_text=Successful'));
}

function handleExitAU(sessionId, res) {
  const session = sessions.get(sessionId);

  if (!session) {
    res.send(buildResponse('error=1\r\nerror_text=Invalid Session ID'));
    return;
  }

  console.log(`[HACP] ExitAU for session: ${sessionId}, Final Status: ${session.lessonStatus}, Score: ${session.score}`);

  res.send(buildResponse('error=0\r\nerror_text=Successful'));
}

function parseAiccData(data) {
  const result = {};
  let currentSection = '';

  const lines = data.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentSection = trimmed.slice(1, -1).toLowerCase();
      continue;
    }

    if (currentSection === 'core') {
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim().toLowerCase().replace(/\s+/g, '_');
        const value = trimmed.substring(eqIndex + 1).trim();
        result[key] = value;
      }
    }

    if (currentSection === 'core_lesson') {
      if (!result.suspend_data) result.suspend_data = '';
      result.suspend_data += trimmed + '\n';
    }
  }

  if (result.suspend_data) {
    result.suspend_data = result.suspend_data.trim();
  }

  return result;
}

function addTimes(total, session) {
  try {
    const toSeconds = (t) => {
      const parts = t.replace(/\./g, ':').split(':');
      const h = parseInt(parts[0]) || 0;
      const m = parseInt(parts[1]) || 0;
      const s = parseInt(parts[2]) || 0;
      return h * 3600 + m * 60 + s;
    };

    const totalSec = toSeconds(total) + toSeconds(session);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;

    return `${String(h).padStart(4, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.00`;
  } catch {
    return total;
  }
}

function buildResponse(content) {
  return content;
}

app.listen(PORT, () => {
  console.log(`[HACP Server] Running on http://localhost:${PORT}`);
  console.log(`[HACP Server] HACP endpoint: http://localhost:${PORT}/hacp`);
});
