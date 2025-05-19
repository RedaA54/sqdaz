const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const fetch = require('node-fetch'); // Add node-fetch for server-side HTTP requests
const app = express();
const port = 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the current directory (including uploads)
app.use(express.static(path.join(__dirname)));

// Configure multer for file uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit per file
});

// Initialize SQLite database
const db = new sqlite3.Database('database.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');

    // Update database schema
    db.serialize(() => {
      // Create agents table with gpuId field
      db.run(`
        CREATE TABLE IF NOT EXISTS agents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          walletAddress TEXT NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          visibility TEXT NOT NULL,
          gpuLevel INTEGER NOT NULL,
          expertise TEXT NOT NULL,
          status TEXT NOT NULL,
          agentQuery TEXT,
          agentDescription TEXT,
          tools TEXT,
          features TEXT,
          gpuId INTEGER NOT NULL,
          databases TEXT,
          imagePath TEXT,
          FOREIGN KEY (gpuId) REFERENCES gpus(id)
        )
      `);

      // Create storages table
      db.run(`
        CREATE TABLE IF NOT EXISTS storages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          walletAddress TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          createdAt TEXT NOT NULL
        )
      `);

      // Create files table
      db.run(`
        CREATE TABLE IF NOT EXISTS files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          storageId INTEGER NOT NULL,
          walletAddress TEXT NOT NULL,
          filename TEXT NOT NULL,
          filepath TEXT NOT NULL,
          size INTEGER NOT NULL,
          uploadedAt TEXT NOT NULL,
          FOREIGN KEY (storageId) REFERENCES storages(id)
        )
      `);

      // Create gpus table
      db.run(`
        CREATE TABLE IF NOT EXISTS gpus (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          maxAgents INTEGER NOT NULL,
          price REAL NOT NULL,
          description TEXT
        )
      `);

      // Create user_gpus table to track purchased GPUs
      db.run(`
        CREATE TABLE IF NOT EXISTS user_gpus (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          walletAddress TEXT NOT NULL,
          gpuId INTEGER NOT NULL,
          purchaseDate TEXT NOT NULL,
          FOREIGN KEY (gpuId) REFERENCES gpus(id)
        )
      `);

      // Seed initial GPUs if the table is empty
      db.get('SELECT COUNT(*) as count FROM gpus', (err, row) => {
        if (err) {
          console.error('Error checking gpus table:', err.message);
          return;
        }
        if (row.count === 0) {
          const initialGpus = [
            { name: "Basic GPU", maxAgents: 1, price: 0.0, description: "Free GPU for 1 agent" },
            { name: "NVIDIA A100", maxAgents: 5, price: 99.99, description: "High-performance GPU for up to 5 agents" },
            { name: "NVIDIA H100", maxAgents: 10, price: 199.99, description: "Advanced GPU for up to 10 agents" },
          ];
          const stmt = db.prepare('INSERT INTO gpus (name, maxAgents, price, description) VALUES (?, ?, ?, ?)');
          initialGpus.forEach(gpu => {
            stmt.run(gpu.name, gpu.maxAgents, gpu.price, gpu.description);
          });
          stmt.finalize();
          console.log('Initial GPUs seeded.');
        }
      });

      // Seed initial agents if the table is empty
      db.get('SELECT COUNT(*) as count FROM agents', (err, row) => {
        if (err) {
          console.error('Error checking agents table:', err.message);
          return;
        }
        if (row.count === 0) {
          // Get the ID of the Basic GPU (free GPU)
          db.get('SELECT id FROM gpus WHERE name = "Basic GPU"', (err, gpuRow) => {
            if (err || !gpuRow) {
              console.error('Error fetching Basic GPU for seeding agents:', err?.message);
              return;
            }
            const basicGpuId = gpuRow.id;
            const initialAgents = [
              { walletAddress: "0xInitial", name: "CryptoGenix", category: "Blockchain", visibility: "Public", gpuLevel: 3, expertise: "Advanced", status: "Active", gpuId: basicGpuId },
              { walletAddress: "0xInitial", name: "BlockBuster", category: "Blockchain", visibility: "Private", gpuLevel: 2, expertise: "Intermediate", status: "Idle", gpuId: basicGpuId },
            ];
            const stmt = db.prepare('INSERT INTO agents (walletAddress, name, category, visibility, gpuLevel, expertise, status, gpuId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            initialAgents.forEach(agent => {
              stmt.run(agent.walletAddress, agent.name, agent.category, agent.visibility, agent.gpuLevel, agent.expertise, agent.status, agent.gpuId);
            });
            stmt.finalize();
            console.log('Initial agents seeded with Basic GPU.');
          });
        }
      });
    });
  }
});

// Helper function to get current timestamp
const getCurrentTimestamp = () => new Date().toISOString();

// Helper function to assign Basic GPU to a user if not already assigned
const assignBasicGpuToUser = (walletAddress, callback) => {
  // Check if the user already has the Basic GPU
  db.get('SELECT id FROM user_gpus WHERE walletAddress = ? AND gpuId = (SELECT id FROM gpus WHERE name = "Basic GPU")', [walletAddress], (err, row) => {
    if (err) {
      console.error('Error checking user_gpus for Basic GPU:', err.message);
      callback(err);
      return;
    }
    if (row) {
      // User already has the Basic GPU
      callback(null);
      return;
    }

    // Fetch the Basic GPU ID
    db.get('SELECT id FROM gpus WHERE name = "Basic GPU"', (err, gpuRow) => {
      if (err || !gpuRow) {
        console.error('Error fetching Basic GPU for user_gpus:', err?.message);
        callback(err || new Error('Basic GPU not found'));
        return;
      }
      const basicGpuId = gpuRow.id;

      // Assign the Basic GPU to the user
      const stmt = db.prepare('INSERT INTO user_gpus (walletAddress, gpuId, purchaseDate) VALUES (?, ?, ?)');
      stmt.run(walletAddress, basicGpuId, getCurrentTimestamp(), (err) => {
        if (err) {
          console.error('Error assigning Basic GPU to user:', err.message);
          callback(err);
          return;
        }
        console.log(`Assigned Basic GPU to user ${walletAddress}`);
        callback(null);
      });
      stmt.finalize();
    });
  });
};

// API Routes for Agents

// GET: Fetch all agents for the connected wallet
app.get('/api/agents', (req, res) => {
  const walletAddress = req.query.walletAddress || '';
  if (!walletAddress) {
    res.status(400).json({ error: 'Wallet address is required' });
    return;
  }
  db.all('SELECT agents.*, gpus.name as gpuName FROM agents LEFT JOIN gpus ON agents.gpuId = gpus.id WHERE agents.walletAddress = ?', [walletAddress], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// POST: Create a new agent
app.post('/api/agents', upload.single('image'), (req, res) => {
  const agentData = JSON.parse(req.body.agent);
  const { walletAddress, name, category, visibility, gpuLevel, expertise, status, agentQuery, agentDescription, tools, features, gpuId, databases } = agentData;
  const imageFilename = req.file ? req.file.filename : null;

  if (!walletAddress || !name || !category || !visibility || !gpuLevel || !expertise || !status || !gpuId) {
    if (req.file) fs.unlinkSync(path.join(uploadDir, req.file.filename));
    res.status(400).json({ error: 'Required fields are missing' });
    return;
  }

  // Validate GPU usage
  db.get('SELECT gpus.maxAgents, COUNT(agents.id) as agentCount FROM gpus LEFT JOIN agents ON agents.gpuId = gpus.id WHERE gpus.id = ? GROUP BY gpus.id', [gpuId], (err, row) => {
    if (err || !row) {
      if (req.file) fs.unlinkSync(path.join(uploadDir, req.file.filename));
      res.status(500).json({ error: 'Error validating GPU usage' });
      return;
    }
    if (row.agentCount >= row.maxAgents) {
      if (req.file) fs.unlinkSync(path.join(uploadDir, req.file.filename));
      res.status(400).json({ error: 'GPU has reached its maximum agent capacity' });
      return;
    }

    const stmt = db.prepare('INSERT INTO agents (walletAddress, name, category, visibility, gpuLevel, expertise, status, agentQuery, agentDescription, tools, features, gpuId, databases, imagePath) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    stmt.run(
      walletAddress,
      name,
      category,
      visibility,
      gpuLevel,
      expertise,
      status,
      agentQuery || '',
      agentDescription || '',
      JSON.stringify(tools || []),
      JSON.stringify(features || []),
      gpuId,
      JSON.stringify(databases || []),
      imageFilename,
      function(err) {
        if (err) {
          if (req.file) fs.unlinkSync(path.join(uploadDir, req.file.filename));
          res.status(500).json({ error: err.message });
          return;
        }
        res.status(201).json({ id: this.lastID });
      }
    );
    stmt.finalize();
  });
});

// PUT: Update an agent
app.put('/api/agents/:id', upload.single('image'), (req, res) => {
  const { id } = req.params;
  const agentData = JSON.parse(req.body.agent);
  const { name, category, visibility, gpuLevel, expertise, status, agentQuery, agentDescription, tools, features, gpuId, databases } = agentData;
  const newImageFilename = req.file ? req.file.filename : null;

  // First, get the current agent to retrieve the old image filename and gpuId
  db.get('SELECT imagePath, gpuId FROM agents WHERE id = ?', [id], (err, row) => {
    if (err) {
      if (req.file) fs.unlinkSync(path.join(uploadDir, newImageFilename));
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      if (req.file) fs.unlinkSync(path.join(uploadDir, newImageFilename));
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const oldImageFilename = row.imagePath;
    const oldGpuId = row.gpuId;
    const finalImageFilename = newImageFilename || oldImageFilename;
    const finalGpuId = gpuId || oldGpuId;

    // Validate GPU usage if gpuId has changed
    if (finalGpuId !== oldGpuId) {
      db.get('SELECT gpus.maxAgents, COUNT(agents.id) as agentCount FROM gpus LEFT JOIN agents ON agents.gpuId = gpus.id WHERE gpus.id = ? AND agents.id != ? GROUP BY gpus.id', [finalGpuId, id], (err, gpuRow) => {
        if (err || !gpuRow) {
          if (req.file) fs.unlinkSync(path.join(uploadDir, newImageFilename));
          res.status(500).json({ error: 'Error validating GPU usage' });
          return;
        }
        if (gpuRow.agentCount >= gpuRow.maxAgents) {
          if (req.file) fs.unlinkSync(path.join(uploadDir, newImageFilename));
          res.status(400).json({ error: 'GPU has reached its maximum agent capacity' });
          return;
        }

        updateAgent();
      });
    } else {
      updateAgent();
    }

    function updateAgent() {
      const stmt = db.prepare('UPDATE agents SET name = ?, category = ?, visibility = ?, gpuLevel = ?, expertise = ?, status = ?, agentQuery = ?, agentDescription = ?, tools = ?, features = ?, gpuId = ?, databases = ?, imagePath = ? WHERE id = ?');
      stmt.run(
        name || null,
        category || null,
        visibility || null,
        gpuLevel || null,
        expertise || null,
        status || null,
        agentQuery || null,
        agentDescription || null,
        tools ? JSON.stringify(tools) : null,
        features ? JSON.stringify(features) : null,
        finalGpuId,
        databases ? JSON.stringify(databases) : null,
        finalImageFilename,
        id,
        function(err) {
          if (err) {
            if (req.file) fs.unlinkSync(path.join(uploadDir, newImageFilename));
            res.status(500).json({ error: err.message });
            return;
          }
          if (this.changes === 0) {
            if (req.file) fs.unlinkSync(path.join(uploadDir, newImageFilename));
            res.status(404).json({ error: 'Agent not found' });
            return;
          }
          // Delete old image file if a new one was uploaded
          if (newImageFilename && oldImageFilename) {
            const oldImagePath = path.join(uploadDir, oldImageFilename);
            if (fs.existsSync(oldImagePath)) {
              fs.unlinkSync(oldImagePath);
            }
          }
          res.json({ message: 'Agent updated successfully' });
        }
      );
      stmt.finalize();
    }
  });
});

// DELETE: Delete an agent
app.delete('/api/agents/:id', (req, res) => {
  const { id } = req.params;

  // First, get the agent's image filename to delete the image file
  db.get('SELECT imagePath FROM agents WHERE id = ?', [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const imageFilename = row.imagePath;

    const stmt = db.prepare('DELETE FROM agents WHERE id = ?');
    stmt.run(id, function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (this.changes === 0) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }
      // Delete the image file if it exists
      if (imageFilename) {
        const imagePath = path.join(uploadDir, imageFilename);
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
        }
      }
      res.json({ message: 'Agent deleted successfully' });
    });
    stmt.finalize();
  });
});

// API Routes for GPUs

// GET: Fetch all available GPUs and their stats
app.get('/api/gpus', (req, res) => {
  const walletAddress = req.query.walletAddress || '';
  if (!walletAddress) {
    res.status(400).json({ error: 'Wallet address is required' });
    return;
  }

  // Assign Basic GPU to the user if not already assigned
  assignBasicGpuToUser(walletAddress, (err) => {
    if (err) {
      res.status(500).json({ error: 'Failed to assign Basic GPU: ' + err.message });
      return;
    }

    // Fetch all GPUs with stats
    db.all(`
      SELECT gpus.*, COUNT(agents.id) as agentCount,
             (SELECT COUNT(*) FROM user_gpus WHERE user_gpus.gpuId = gpus.id AND user_gpus.walletAddress = ?) as isPurchased
      FROM gpus
      LEFT JOIN agents ON agents.gpuId = gpus.id
      GROUP BY gpus.id
    `, [walletAddress], (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    });
  });
});

// GET: Fetch GPUs available to the user for agent creation
app.get('/api/user-gpus', (req, res) => {
  const walletAddress = req.query.walletAddress || '';
  if (!walletAddress) {
    res.status(400).json({ error: 'Wallet address is required' });
    return;
  }

  // Assign Basic GPU to the user if not already assigned
  assignBasicGpuToUser(walletAddress, (err) => {
    if (err) {
      res.status(500).json({ error: 'Failed to assign Basic GPU: ' + err.message });
      return;
    }

    // Fetch user's GPUs
    db.all(`
      SELECT gpus.*
      FROM gpus
      INNER JOIN user_gpus ON gpus.id = user_gpus.gpuId
      WHERE user_gpus.walletAddress = ?
    `, [walletAddress], (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    });
  });
});

// POST: Purchase a GPU (mock purchase)
app.post('/api/gpus/purchase', (req, res) => {
  const { walletAddress, gpuId } = req.body;
  if (!walletAddress || !gpuId) {
    res.status(400).json({ error: 'Wallet address and GPU ID are required' });
    return;
  }

  // Check if the GPU exists and get its price
  db.get('SELECT price FROM gpus WHERE id = ?', [gpuId], (err, row) => {
    if (err || !row) {
      res.status(404).json({ error: 'GPU not found' });
      return;
    }

    // If price is 0 (e.g., Basic GPU), it should already be assigned, so skip purchase
    if (row.price === 0) {
      res.status(400).json({ error: 'This GPU is free and should already be available' });
      return;
    }

    // Check if the user already owns this GPU
    db.get('SELECT id FROM user_gpus WHERE walletAddress = ? AND gpuId = ?', [walletAddress, gpuId], (err, existing) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (existing) {
        res.status(400).json({ error: 'You already own this GPU' });
        return;
      }

      // Mock purchase: assume payment is successful
      const stmt = db.prepare('INSERT INTO user_gpus (walletAddress, gpuId, purchaseDate) VALUES (?, ?, ?)');
      stmt.run(walletAddress, gpuId, getCurrentTimestamp(), function(err) {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        res.status(201).json({ message: 'GPU purchased successfully' });
      });
      stmt.finalize();
    });
  });
});

// API Route for OpenAI Chat Completions
const OPENAI_API_KEY = 'your-openai-api-key-here'; // Replace with your actual OpenAI API key
app.post('/api/openai/chat', async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'Messages array is required' });
    return;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages,
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'Failed to fetch response from OpenAI');
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Error calling OpenAI API:', err.message);
    res.status(500).json({ error: 'Failed to communicate with OpenAI: ' + err.message });
  }
});

// API Routes for Storage

// GET: Fetch all storages for the connected wallet
app.get('/api/storages', (req, res) => {
  const walletAddress = req.query.walletAddress || '';
  if (!walletAddress) {
    res.status(400).json({ error: 'Wallet address is required' });
    return;
  }
  db.all('SELECT * FROM storages WHERE walletAddress = ?', [walletAddress], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// POST: Create a new storage
app.post('/api/storages', (req, res) => {
  const { walletAddress, name, description } = req.body;
  if (!walletAddress || !name) {
    res.status(400).json({ error: 'Wallet address and name are required' });
    return;
  }
  const stmt = db.prepare('INSERT INTO storages (walletAddress, name, description, createdAt) VALUES (?, ?, ?, ?)');
  stmt.run(walletAddress, name, description || '', getCurrentTimestamp(), function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.status(201).json({ id: this.lastID });
  });
  stmt.finalize();
});

// GET: Fetch total storage usage for the connected wallet
app.get('/api/storage-usage', (req, res) => {
  const walletAddress = req.query.walletAddress || '';
  if (!walletAddress) {
    res.status(400).json({ error: 'Wallet address is required' });
    return;
  }
  db.get('SELECT SUM(size) as totalSize FROM files WHERE walletAddress = ?', [walletAddress], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    const totalSize = row.totalSize || 0; // in bytes
    const maxSize = 500 * 1024 * 1024; // 500MB in bytes
    res.json({ used: totalSize, max: maxSize, percentage: (totalSize / maxSize) * 100 });
  });
});

// GET: Fetch all files in a storage
app.get('/api/storages/:id/files', (req, res) => {
  const { id } = req.params;
  const walletAddress = req.query.walletAddress || '';
  if (!walletAddress) {
    res.status(400).json({ error: 'Wallet address is required' });
    return;
  }
  db.all('SELECT * FROM files WHERE storageId = ? AND walletAddress = ?', [id, walletAddress], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// POST: Upload a file to a storage
app.post('/api/storages/:id/files', upload.single('file'), async (req, res) => {
  const { id } = req.params;
  const walletAddress = req.body.walletAddress || '';
  if (!walletAddress) {
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(400).json({ error: 'Wallet address is required' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  // Check storage usage
  const maxSize = 500 * 1024 * 1024; // 500MB in bytes
  const fileSize = req.file.size; // in bytes

  db.get('SELECT SUM(size) as totalSize FROM files WHERE walletAddress = ?', [walletAddress], (err, row) => {
    if (err) {
      fs.unlinkSync(req.file.path);
      res.status(500).json({ error: err.message });
      return;
    }
    const currentSize = row.totalSize || 0;
    if (currentSize + fileSize > maxSize) {
      fs.unlinkSync(req.file.path);
      res.status(400).json({ error: 'Storage limit exceeded. You have reached your 500MB limit.' });
      return;
    }

    // Save file metadata to database
    const stmt = db.prepare('INSERT INTO files (storageId, walletAddress, filename, filepath, size, uploadedAt) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run(
      id,
      walletAddress,
      req.file.originalname,
      req.file.path,
      fileSize,
      getCurrentTimestamp(),
      function(err) {
        if (err) {
          fs.unlinkSync(req.file.path);
          res.status(500).json({ error: err.message });
          return;
        }
        res.status(201).json({ id: this.lastID, filename: req.file.originalname, size: fileSize });
      }
    );
    stmt.finalize();
  });
});

// GET: Read file contents (for AI)
app.get('/api/files/:id/read', (req, res) => {
  const { id } = req.params;
  const walletAddress = req.query.walletAddress || '';
  if (!walletAddress) {
    res.status(400).json({ error: 'Wallet address is required' });
    return;
  }
  db.get('SELECT filepath FROM files WHERE id = ? AND walletAddress = ?', [id, walletAddress], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    fs.readFile(row.filepath, 'utf8', (err, data) => {
      if (err) {
        res.status(500).json({ error: 'Error reading file' });
        return;
      }
      // Simple AI processing: Summarize or extract info (for demo, just return the content)
      res.json({ content: data, summary: data.length > 100 ? data.slice(0, 97) + '...' : data });
    });
  });
});

// Serve HTML pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/create-agent', (req, res) => {
  res.sendFile(path.join(__dirname, 'create-agent.html'));
});

app.get('/storage', (req, res) => {
  res.sendFile(path.join(__dirname, 'storage.html'));
});

app.get('/connect-wallet', (req, res) => {
  res.sendFile(path.join(__dirname, 'connect-wallet.html'));
});

app.get('/gpu', (req, res) => {
  res.sendFile(path.join(__dirname, 'gpu.html'));
});

app.get('/playground', (req, res) => {
  res.sendFile(path.join(__dirname, 'playground.html'));
});

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

// Close the database connection on server shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});