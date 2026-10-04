import os
import secrets
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy

load_dotenv(dotenv_path=Path(__file__).with_name(".env"))

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///main.db"
app.config["SECRET_KEY"] = os.getenv("FLASK_SECRET_KEY") or secrets.token_urlsafe(32)
app.config["ADMIN_API_KEY"] = os.getenv("ADMIN_API_KEY")
CORS(app, supports_credentials=True)
db = SQLAlchemy(app)

from backend.models.models import (
	Atividade,
	EntregaAtividade,
	Jogo,
	ParticipanteJogo,
	Professor,
	QuestaoJogo,
	RespostaJogo,
	Turma,
	User,
)
from backend.routes.router import bp

app.register_blueprint(bp)

with app.app_context():
	db.create_all()