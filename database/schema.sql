-- VitalTrack SQLite schema (exported from the live database)
-- Regenerate with: python backend/export_schema.py

CREATE TABLE alerts (
	id INTEGER NOT NULL, 
	patient_id INTEGER NOT NULL, 
	reading_id INTEGER, 
	vital_type VARCHAR(32), 
	severity VARCHAR(16), 
	title VARCHAR(128), 
	message VARCHAR(255), 
	is_read BOOLEAN, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(patient_id) REFERENCES patients (id), 
	FOREIGN KEY(reading_id) REFERENCES vital_readings (id)
);

CREATE TABLE devices (
	id INTEGER NOT NULL, 
	device_uid VARCHAR(64) NOT NULL, 
	patient_id INTEGER, 
	api_key VARCHAR(64) NOT NULL, 
	firmware_version VARCHAR(16), 
	wifi_signal INTEGER, 
	battery_level INTEGER, 
	last_seen DATETIME, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	UNIQUE (device_uid), 
	FOREIGN KEY(patient_id) REFERENCES patients (id), 
	UNIQUE (api_key)
);

CREATE TABLE patients (
	id INTEGER NOT NULL, 
	patient_code VARCHAR(20) NOT NULL, 
	name VARCHAR(128) NOT NULL, 
	age INTEGER, 
	gender VARCHAR(16), 
	ward VARCHAR(64), 
	status VARCHAR(16), 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	UNIQUE (patient_code)
);

CREATE TABLE users (
	id INTEGER NOT NULL, 
	username VARCHAR(64) NOT NULL, 
	full_name VARCHAR(128) NOT NULL, 
	password_hash VARCHAR(255) NOT NULL, 
	role VARCHAR(32) NOT NULL, 
	created_at DATETIME, 
	PRIMARY KEY (id)
);

CREATE TABLE vital_readings (
	id INTEGER NOT NULL, 
	patient_id INTEGER NOT NULL, 
	device_id INTEGER, 
	heart_rate FLOAT, 
	spo2 FLOAT, 
	temperature FLOAT, 
	ecg_status VARCHAR(32), 
	recorded_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(patient_id) REFERENCES patients (id), 
	FOREIGN KEY(device_id) REFERENCES devices (id)
);

CREATE INDEX ix_alerts_created_at ON alerts (created_at);

CREATE INDEX ix_alerts_patient_id ON alerts (patient_id);

CREATE INDEX ix_alerts_patient_type_time ON alerts (patient_id, vital_type, created_at);

CREATE UNIQUE INDEX ix_users_username ON users (username);

CREATE INDEX ix_vital_readings_patient_id ON vital_readings (patient_id);

CREATE INDEX ix_vital_readings_patient_time ON vital_readings (patient_id, recorded_at);

CREATE INDEX ix_vital_readings_recorded_at ON vital_readings (recorded_at);