import mysql.connector

# Connect without database first to create it
conn = mysql.connector.connect(
    host='localhost',
    user='root',
    password='abcel5425@'
)

cursor = conn.cursor()

# Create database
cursor.execute('CREATE DATABASE IF NOT EXISTS attendiq')
conn.commit()
print('Database created/verified')
cursor.close()
conn.close()

# Reconnect to the attendiq database
conn = mysql.connector.connect(
    host='localhost',
    user='root',
    password='abcel5425@',
    database='attendiq'
)

cursor = conn.cursor()

# Read schema
with open('backend/schema.sql', 'r') as f:
    schema = f.read()

# Execute each statement
for stmt in schema.split(';'):
    stmt = stmt.strip()
    if stmt:
        cursor.execute(stmt)
        conn.commit()
        print(f'Executed: {stmt[:60]}...')

cursor.close()
conn.close()
print('Schema imported successfully!')
