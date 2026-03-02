# 🚀 Installation Guide

## PART 1 - RPI and SSH connection
### 0️⃣ Update the System and install required packages
On the Raspberry Pi:
```
sudo apt update
sudo apt upgrade -y
```

Install required packages:
```
sudo apt install git -y
sudo apt install openssh-client -y
sudo apt install python3 python3-pip python3-venv -y
sudo apt install nodejs npm -y
```

### 1️⃣ Create SSH Key to clone the repository
Generate SSH key:
```
ssh-keygen -t ed25519 -C "your_email@example.com"
```
Press ENTER 3x
Copy public key:
```
cat ~/.ssh/id_ed25519.pub
```
- Go to the correct GitHub account
- Settings → SSH and GPG keys
- New SSH Key
- Paste key

Test connection:
```
ssh -T git@github.com
```

### 2️⃣ Clone the Dashboard Repository
git clone git@github.com:techtile-by-dramco/dashboard.git
cd dashboard
ls

You should see the repository structure: 
- backend/          (not needed)  ~LYSSA, DELETE
- dashboard/        (Node frontend)
- pythonBackend/    (Python backend)

## PART 2 – Install Mosquitto (Mosquito.service) (REQUIRED)
TechtileDashboard depends on MQTT for:
- Live RPI updates
- Midspan data
- PoE control
- PDU control
- Experiment status

Without Mosquitto, the dashboard will not function properly.

### Install Mosquitto
```
sudo apt update
sudo apt install mosquitto mosquitto-clients -y
```
### Verify installation
´´´
systemctl status mosquitto
´´´
### Enable Mosquitto at Boot
```
sudo systemctl enable mosquitto
sudo systemctl start mosquitto
```

## PART 3 – Install SSH (ssh.service) (REQUIRED)
TechtileDashboard depends on SSH for:
- Remote SSH login into your Raspberry Pi
- ssh pi@<ip>
- Git over SSH
- Remote management

### Install SSH
```
sudo apt install openssh-server
```

### Enable Mosquitto at Boot
```
sudo systemctl enable ssh
sudo systemctl start ssh
```

## PART 4 – Setup Python Backend
The important files for the backend are inside:
```
cd pythonBackend
```
Contains:
- server.py
- rpis_control.py
- pdu_control.py
- midspan_control.py
- SNMP_Midspan.py  (not needed ~LYSSA CHECK and DELETE)
- mqtt_config.py (no service connected to it)
- *.yaml config files
  
### 3️⃣ Create Python Virtual Environment

```
cd pythonBackend
python3 -m venv venv
source venv/bin/activate
```
Install required libraries (adjust if needed), like: 
```
pip install flask paho-mqtt pyyaml requests pysnmp
```
(If other modules are missing, install them when errors appear.)

### 4️⃣ Test Backend Manually (IMPORTANT)
Before creating services: 
```
cd ~/dashboard/pythonBackend
source venv/bin/activate
python server.py
```
- Do this foor all the python files in /pythonBackend
  - server.py --> run by **backend.service**
  - rpis_control.py --> run by **rpis_control.service**
  - pdu_control.py --> run by **pdu_control.service**
  - midspan_control.py --> run by **midspans_control.service**
  - rpi_db.py --> run by **mqtt-collector.service** 
  
- Install libraries when errors appear
- Stop with:
  ```Ctrl + C ```

  
### 5️⃣ Create Python Backend Service

5.1 backend.service
```
sudo nano /etc/systemd/system/Test_RPI.service
# Copy past content form the backend.service file on Github
# Save and exit .service file
sudo systemctl daemon-reload
sudo systemctl enable backend.service
sudo systemctl start backend.service
systemctl status backend.service
```

5.2 rpis_control.service
```
sudo nano /etc/systemd/system/rpis_control.service
# Copy past content form the rpis_control.service file on Github
# Save and exit .service file
sudo systemctl daemon-reload
sudo systemctl enable rpis_control.service
sudo systemctl start rpis_control.service
systemctl status rpis_control.service
```

5.3 pdu_control.service
```
sudo nano /etc/systemd/system/pdu_control.service
# Copy past content form the Test_RPI.service file on Github
# Save and exit .service file
sudo systemctl daemon-reload
sudo systemctl enable pdu_control.service
sudo systemctl start pdu_control.service
systemctl status pdu_control.service
```


5.4 midspans_control.service
```
sudo nano /etc/systemd/system/midspans_control.service
# Copy past content form the midspans_control.service file on Github
# Save and exit .service file
sudo systemctl daemon-reload
sudo systemctl enable midspans_control.service
sudo systemctl start midspans_control.service
systemctl status midspans_control.service
```

5.5 mqtt-collector.service
```
sudo nano /etc/systemd/system/mqtt-collector.service
# Copy past content form the mqtt-collector.service file on Github
# Save and exit .service file
sudo systemctl daemon-reload
sudo systemctl enable mqtt-collector.service
sudo systemctl start mqtt-collector.service
systemctl status mqtt-collector.service
```

5.6 Troubleshoot (if necessary)
- Restart after changes:

```
sudo systemctl restart Test_RPI.service
sudo systemctl restart rpi-control.service 
```

- Verify start after reboot (if service is enabled)
```sudo reboot```


## PART 5 – Setup Python Frontend/Dashboard
The important files for the frontend are inside:
```
cd dashboard/src
```
### Install + run in dev mode (quick test)
Install node:
```
node -v
npm -v
```
Test React manaully (no service yet)
```
cd ~/TechtileDashboard/dashboard
npm install
npm start
```

Open in Browser: ``` http://10.128.48.5:3000/ ```

Stop it with: ```Ctrl+C```

### Create react-app.service

```
sudo nano /etc/systemd/system/react-app.service
# Copy past content form the react-app.service file on Github
# Save and exit .service file
sudo systemctl daemon-reload
sudo systemctl enable react-app.service
sudo systemctl start react-app.service
systemctl status react-app.service
```

Check the logs if it fails
```
journalctl -u react-app.service -f


