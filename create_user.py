from database import get_connection

db = get_connection()
cursor = db.cursor()

sql = """
INSERT INTO users (name, email)
VALUES (%s, %s)
"""

values = ("Monika", "monika@test.com")

cursor.execute(sql, values)
db.commit()

print("User created successfully!")
print("User ID:", cursor.lastrowid)

cursor.close()
db.close()
