const crypto = require('crypto');

// In-memory session store (persists within a single function instance)
// Note: This resets when the function cold-starts. For production, use a database.
const sessions = new Map();

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type': 'text/plain',
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const path = event.path.replace('/.netlify/functions/hacp', '').replace('/api/hacp', '');

  // Route: POST /api/hacp/create-session
  if (path === '/create-session' && event.httpMethod === 'POST') {
    return handleCreateSession(event, headers);
  }

  // Route: GET /api/hacp/sessions
  if (path === '/sessions' && event.httpMethod === 'GET') {
    return handleGetSessions(headers);
  }

  // Route: POST /api/hacp (main HACP endpoint)
  if (event.httpMethod === 'POST') {
    return handleHacp(event, headers);
  }

  return {
    statusCode: 404,
    headers,
    body: 'Not found',
  };
};

function handleCreateSession(event, headers) {
  const body = JSON.parse(event.body || '{}');
  const { courseId, studentId, studentName } = body;
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

  return {
    statusCode: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  };
}

function handleGetSessions(headers) {
  const result = {};
  sessions.forEach((value, key) => {
    result[key] = value;
  });
  return {
    statusCode: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  };
}

function handleHacp(event, headers) {
  // Parse URL-encoded or JSON body
  let body = {};
  const contentType = (event.headers['content-type'] || '').toLowerCase();

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(event.body);
    params.forEach((value, key) => {
      body[key] = value;
    });
  } else {
    body = JSON.parse(event.body || '{}');
  }

  const command = (body.command || '').toLowerCase();
  const sessionId = body.session_id || '';

  switch (command) {
    case 'getparam':
      return handleGetParam(sessionId, headers);
    case 'putparam':
      return handlePutParam(sessionId, body, headers);
    case 'exitau':
      return handleExitAU(sessionId, headers);
    default:
      return {
        statusCode: 200,
        headers,
        body: 'error=1\r\nerror_text=Unknown command',
      };
  }
}

function handleGetParam(sessionId, headers) {
  const session = sessions.get(sessionId) || {
    studentId: 'student_001',
    studentName: 'Test, Student',
    credit: 'credit',
    lessonStatus: 'not attempted',
    entry: 'ab-initio',
    score: '',
    totalTime: '0000:00:00.00',
    lessonLocation: '',
    suspendData: '',
    lessonMode: 'normal',
    masteryScore: '',
    comments: '',
    objectives: '',
  };

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

  return { statusCode: 200, headers, body: aiccData };
}

function handlePutParam(sessionId, body, headers) {
  const session = sessions.get(sessionId);

  if (!session) {
    return {
      statusCode: 200,
      headers,
      body: 'error=1\r\nerror_text=Invalid Session ID',
    };
  }

  const aiccData = body.aicc_data || '';
  const parsed = parseAiccData(aiccData);

  if (parsed.lesson_status) session.lessonStatus = parsed.lesson_status;
  if (parsed.score) session.score = parsed.score;
  if (parsed.score_raw) session.scoreRaw = parsed.score_raw;
  if (parsed.time) session.sessionTime = parsed.time;
  if (parsed.lesson_location) session.lessonLocation = parsed.lesson_location;
  if (parsed.suspend_data !== undefined) session.suspendData = parsed.suspend_data;

  if (parsed.time) {
    session.totalTime = addTimes(session.totalTime, parsed.time);
  }

  if (session.lessonStatus === 'incomplete') {
    session.entry = 'resume';
  }

  return {
    statusCode: 200,
    headers,
    body: 'error=0\r\nerror_text=Successful',
  };
}

function handleExitAU(sessionId, headers) {
  const session = sessions.get(sessionId);

  if (!session) {
    return {
      statusCode: 200,
      headers,
      body: 'error=1\r\nerror_text=Invalid Session ID',
    };
  }

  return {
    statusCode: 200,
    headers,
    body: 'error=0\r\nerror_text=Successful',
  };
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
