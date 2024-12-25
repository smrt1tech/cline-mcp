#!/usr/bin/env node
import { Client, ExecOptions } from 'ssh2';

class SSHServer {
  private sshClient: Client | null = null;
  private sshConfig = {
    host: '192.168.1.105',
    username: 'smrt1',
    privateKey: require('fs').readFileSync(process.env.SSH_KEY_PATH || `${process.env.HOME}/.ssh/id_rsa`)
  };

  constructor() {
    process.on('SIGINT', async () => {
      if (this.sshClient) {
        this.sshClient.end();
      }
      process.exit(0);
    });
  }

  public async connect(): Promise<void> {
    if (this.sshClient) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.sshClient = new Client();
      
      this.sshClient
        .on('ready', () => {
          resolve();
        })
        .on('error', (err) => {
          reject(err);
        })
        .connect(this.sshConfig);
    });
  }

  public async executeCommand(command: string, options: ExecOptions = {}): Promise<void> {
    if (!this.sshClient) {
      throw new Error('SSH client not connected');
    }

    // Use NOPASSWD sudo configuration instead of password piping
    if (command.startsWith('sudo')) {
      command = command.slice(5);
    }

    return new Promise<void>((resolve, reject) => {
      this.sshClient!.exec(command, (err: Error | undefined, stream: any) => {
        if (err) {
          reject(err);
          return;
        }

        // Handle both stdout and stderr in real-time
        stream.on('data', (data: Buffer) => {
          process.stdout.write(data.toString());
        });

        stream.stderr.on('data', (data: Buffer) => {
          process.stderr.write(data.toString());
        });

        stream.on('end', () => {
          resolve();
        });

        stream.on('error', (err: Error) => {
          reject(err);
        });
      });
    });
  }

}

import * as readline from 'readline';

// Create and connect the SSH server
const server = new SSHServer();
server.connect().then(async () => {
  console.log('Connected to SSH server');
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  // Execute setup commands
  console.log('Starting server setup...');
  try {
    // Install XFCE and VNC
    console.log('Installing XFCE desktop environment...');
    await server.executeCommand('sudo apt install xfce4 xfce4-goodies -y');
    
    console.log('Installing VNC server...');
    await server.executeCommand('sudo apt install tightvncserver -y');
    
    // Set up VNC password (using expect to automate password entry)
    console.log('Setting up VNC password...');
    await server.executeCommand('sudo apt install expect -y');
    const vncSetupScript = `
expect << EOF
spawn vncpasswd
expect "Password:"
send "smrt1pass\\r"
expect "Verify:"
send "smrt1pass\\r"
expect "Would you like to enter a view-only password (y/n)?"
send "n\\r"
expect eof
EOF`;
    await server.executeCommand(vncSetupScript);
    
    // Kill the initial VNC server instance
    await server.executeCommand('vncserver -kill :1');
    
    // Configure VNC startup
    console.log('Configuring VNC startup...');
    const xstartup = `#!/bin/bash
xrdb $HOME/.Xresources
startxfce4 &`;
    
    await server.executeCommand('mkdir -p ~/.vnc');
    await server.executeCommand(`echo '${xstartup}' > ~/.vnc/xstartup`);
    await server.executeCommand('chmod +x ~/.vnc/xstartup');
    
    // Create systemd service for VNC
    const serviceConfig = `[Unit]
Description=Remote desktop service (VNC)
After=syslog.target network.target

[Service]
Type=forking
User=smrt1
Group=smrt1
WorkingDirectory=/home/smrt1

PIDFile=/home/smrt1/.vnc/%H:%i.pid
ExecStartPre=-/usr/bin/vncserver -kill :%i > /dev/null 2>&1
ExecStart=/usr/bin/vncserver -depth 24 -geometry 1920x1080 :%i
ExecStop=/usr/bin/vncserver -kill :%i

[Install]
WantedBy=multi-user.target`;
    
    // Write service file with proper permissions
    await server.executeCommand('rm -f /tmp/vncserver.service');
    await server.executeCommand(`printf '%s\\n' "[Unit]
Description=Remote desktop service (VNC)
After=syslog.target network.target

[Service]
Type=forking
User=smrt1
Group=smrt1
WorkingDirectory=/home/smrt1

PIDFile=/home/smrt1/.vnc/%H:%i.pid
ExecStartPre=-/usr/bin/vncserver -kill :%i > /dev/null 2>&1
ExecStart=/usr/bin/vncserver -depth 24 -geometry 1920x1080 :%i
ExecStop=/usr/bin/vncserver -kill :%i

[Install]
WantedBy=multi-user.target" > /tmp/vncserver.service`);
    await server.executeCommand('sudo cp /tmp/vncserver.service /etc/systemd/system/vncserver@1.service');
    await server.executeCommand('sudo chown root:root /etc/systemd/system/vncserver@1.service');
    await server.executeCommand('sudo chmod 644 /etc/systemd/system/vncserver@1.service');
    
    // Verify service file exists
    await server.executeCommand('ls -l /etc/systemd/system/vncserver@1.service');
    
    // Enable and start VNC service
    await server.executeCommand('sudo systemctl daemon-reload');
    await server.executeCommand('sudo systemctl enable vncserver@1.service');
    
    // Start VNC manually first to ensure it works
    await server.executeCommand('vncserver :1 -depth 24 -geometry 1920x1080');
    
    // Then try to start it as a service
    await server.executeCommand('sudo systemctl start vncserver@1.service || true');
    
    // Verify VNC service status
    await server.executeCommand('sudo systemctl status vncserver@1.service');
    
    console.log('XFCE and VNC installed and configured successfully.');
    console.log('You can now connect to VNC using a client at <zerotier-ip>:5901');
    process.exit(0);
  } catch (error) {
    console.error('Error during setup:', error);
    process.exit(1);
  }
}).catch(console.error);
