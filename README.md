python3.9 -m venv spleeter-venv39
source spleeter-venv39/bin/activate
python3.9 -m pip install spleeter
spleeter-venv39/bin/spleeter separate -i input_audio.mp3 -o output_dir && deactivate

docker pull deezer/spleeter:3.8-5stems
docker run -v $(pwd):/input_output deezer/spleeter:3.8-5stems separate -i /input_output/input_audio.mp3 -o /input_output/output_dir

conda create -n spleeter python=3.9 -y
conda init
conda activate spleeter
conda install -c conda-forge tensorflow

conda create -n py38 python=3.8 -y
conda activate py38
conda install -c conda-forge ffmpeg libsndfile
pip install spleeter
